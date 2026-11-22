import type { PanamaStoreConfig } from "@regateo/shared";
import { mapWithConcurrency } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * High speed Shopify JSON adapter.
 *
 * Multimax, Rodelag and Almacenes Titán all expose the public
 * `/collections/<handle>/products.json` endpoint, which is the exact same data
 * their storefront renders (real prices, compare-at prices, stock, images and
 * the canonical `/products/<handle>` URL). No HTML parsing and no Firecrawl
 * credits are needed for these three stores.
 */

export interface ShopifyVariant {
  id: number | string;
  title?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  available?: boolean | null;
  sku?: string | null;
  /** GTIN/EAN/UPC (Shopify exposes it as `barcode`). */
  barcode?: string | null;
  option1?: string | null;
  option2?: string | null;
}

export interface ShopifyProduct {
  id: number | string;
  title: string;
  handle: string;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: ShopifyVariant[];
  images?: Array<{ src?: string | null; alt?: string | null }>;
  body_html?: string | null;
}

interface ShopifyCollectionResponse {
  products?: ShopifyProduct[];
}

const SHOPIFY_PAGE_SIZE = 250;

function normalizeTags(tags: ShopifyProduct["tags"]): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Picks the cheapest available variant (falls back to the cheapest overall). */
export function pickShopifyVariant(
  product: ShopifyProduct
): { priceCents: number; originalPriceCents: number | null; inStock: boolean; variant: ShopifyVariant } | null {
  const variants = (product.variants ?? []).filter((variant) => {
    const cents = parsePriceToCents(variant.price);
    return cents !== null && cents > 0;
  });
  if (variants.length === 0) return null;

  const available = variants.filter((variant) => variant.available !== false);
  const candidates = available.length > 0 ? available : variants;
  const priced = candidates
    .map((variant) => ({ variant, priceCents: parsePriceToCents(variant.price) ?? 0 }))
    .sort((a, b) => a.priceCents - b.priceCents);

  const chosen = priced[0]!;
  const compareAt = parsePriceToCents(chosen.variant.compare_at_price ?? null);
  const originalPriceCents = compareAt && compareAt > chosen.priceCents ? compareAt : null;

  return {
    priceCents: chosen.priceCents,
    originalPriceCents,
    inStock: chosen.variant.available !== false,
    variant: chosen.variant,
  };
}

export function mapShopifyProduct(
  product: ShopifyProduct,
  store: PanamaStoreConfig
): RawScrapedItem | null {
  const picked = pickShopifyVariant(product);
  if (!picked) return null;

  const image = product.images?.find((entry) => typeof entry.src === "string" && entry.src.length > 0);
  const baseUrl = store.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/products/${product.handle}`;

  const item: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: String(product.id),
    title: product.title.trim(),
    brand: product.vendor?.trim() ?? null,
    sku: picked.variant.sku ?? null,
    gtin: picked.variant.barcode ?? null,
    productType: product.product_type ?? null,
    priceCents: picked.priceCents,
    originalPriceCents: picked.originalPriceCents,
    currency: "USD",
    inStock: picked.inStock,
    url,
    imageUrl: image?.src ?? null,
    rawSpecs: {
      platform: "shopify",
      handle: product.handle,
      vendor: product.vendor ?? null,
      productType: product.product_type ?? null,
      tags: normalizeTags(product.tags),
      variantId: picked.variant.id,
      variantTitle: picked.variant.title ?? null,
      sku: picked.variant.sku ?? null,
      gtin: picked.variant.barcode ?? null,
      compareAtPrice: picked.variant.compare_at_price ?? null,
      description: stripHtml(product.body_html).slice(0, 400),
    },
  };

  if (!isRelevantElectronicsProduct(item)) return null;
  return item;
}

function collectionHandles(store: PanamaStoreConfig): string[] {
  const handles: string[] = [];
  for (const path of store.scrapePaths) {
    const match = path.match(/^\/collections\/([^/]+)\/products\.json$/);
    if (match?.[1] && !handles.includes(match[1])) handles.push(match[1]);
  }
  return handles;
}

/** Above this budget we page the whole catalog instead of a single page per shelf. */
const FULL_MODE_THRESHOLD = 250;
/** Shopify's public products.json is capped at 250 items/page. */
const PAGE_PAUSE_MS = 400;
const MAX_PAGE_RETRIES = 5;
/** Shopify rejects deep pages (>25k products) with HTTP 400; stop there. */
const MAX_GLOBAL_PAGES = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ShopifyPage {
  products: ShopifyProduct[];
  status: number;
  rateLimited: boolean;
}

/** One products.json request with polite exponential backoff on 429 / throttling. */
async function requestShopifyPage(url: string, signal?: AbortSignal): Promise<ShopifyPage> {
  for (let attempt = 0; attempt < MAX_PAGE_RETRIES; attempt += 1) {
    if (signal?.aborted) return { products: [], status: 0, rateLimited: true };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "application/json",
          "Accept-Language": "es-PA,es;q=0.9,en;q=0.8",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const body = await response.text();
      const rateLimited =
        response.status === 429 ||
        /local_rate_limited|too many requests|rate.?limit/i.test(body.slice(0, 400));

      if (rateLimited) {
        await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      if (response.status >= 500) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (!response.ok) return { products: [], status: response.status, rateLimited: false };

      try {
        const payload = JSON.parse(body) as ShopifyCollectionResponse;
        return {
          products: Array.isArray(payload.products) ? payload.products : [],
          status: response.status,
          rateLimited: false,
        };
      } catch {
        return { products: [], status: response.status, rateLimited: false };
      }
    } catch {
      await sleep(800 * (attempt + 1));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return { products: [], status: 0, rateLimited: true };
}

async function fetchCollectionPage(
  baseUrl: string,
  collection: string | null,
  page: number,
  signal?: AbortSignal
): Promise<ShopifyPage> {
  const root = baseUrl.replace(/\/+$/, "");
  const path = collection
    ? `${root}/collections/${collection}/products.json`
    : `${root}/products.json`;
  return requestShopifyPage(`${path}?limit=${SHOPIFY_PAGE_SIZE}&page=${page}`, signal);
}

/**
 * Pages one collection (or the global catalog when `collection` is null) with
 * polite pacing until Shopify runs out of pages or the budget is reached.
 */
async function pageShopifyCatalog(
  store: PanamaStoreConfig,
  collection: string | null,
  maxItems: number,
  context: AdapterContext,
  maxPages = Number.POSITIVE_INFINITY
): Promise<RawScrapedItem[]> {
  const collected: RawScrapedItem[] = [];
  let emptyStreak = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    if (context.signal?.aborted) break;
    const { products, status, rateLimited } = await fetchCollectionPage(
      store.baseUrl,
      collection,
      page,
      context.signal
    );

    if (rateLimited || status === 0) {
      context.log(
        `  ${store.slug}/${collection ?? "catálogo"} página ${page}: límite de tasa persistente, se detiene esta serie`
      );
      break;
    }
    if (status === 400 || status === 404) {
      // 400 = Shopify's hard page cap reached; 404 = handle does not exist.
      break;
    }
    if (products.length === 0) {
      emptyStreak += 1;
      if (emptyStreak >= 2) break;
      await sleep(PAGE_PAUSE_MS);
      continue;
    }
    emptyStreak = 0;

    for (const product of products) {
      const item = mapShopifyProduct(product, store);
      if (item) collected.push(item);
    }

    if (page % 10 === 0) {
      context.log(
        `  ${store.slug}/${collection ?? "catálogo"}: página ${page} · ${collected.length} relevantes`
      );
    }

    if (collected.length >= maxItems) break;
    if (products.length < SHOPIFY_PAGE_SIZE) break;
    await sleep(PAGE_PAUSE_MS);
  }

  return collected;
}

export function createShopifyAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "shopify-json",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const collections = collectionHandles(store);
      const fullMode = context.maxPerStore > FULL_MODE_THRESHOLD;

      // ---- Full catalog mode: sequential paging with polite 400 ms pauses. --
      if (fullMode) {
        const collected: RawScrapedItem[] = [];
        const targets = collections.length > 0 ? collections : [null];

        for (const collection of targets) {
          if (collected.length >= context.maxPerStore) break;
          const items = await pageShopifyCatalog(
            store,
            collection,
            context.maxPerStore - collected.length,
            context
          );
          collected.push(...items);
          context.log(
            `  ${store.slug}/${collection ?? "catálogo"}: ${items.length} relevantes (acumulado ${collected.length})`
          );
        }

        // Global sweep: catches products that live outside the configured
        // shelves (Titán keeps a lot of electronics outside its collections).
        if (collected.length < context.maxPerStore) {
          const remaining = context.maxPerStore - collected.length;
          const globalItems = await pageShopifyCatalog(
            store,
            null,
            remaining,
            context,
            MAX_GLOBAL_PAGES
          );
          collected.push(...globalItems);
          context.log(
            `  ${store.slug}/products.json: ${globalItems.length} relevantes adicionales`
          );
        }

        const unique = dedupeItems(collected).slice(0, context.maxPerStore);
        context.log(
          `  ${store.slug}: ${unique.length} productos relevantes (catálogo completo · ${collections.length} colecciones + barrido global)`
        );
        return unique;
      }

      // ---- Small budget mode: fast, one page per shelf, round-robin. --------
      const targets: Array<string | null> = collections.length > 0 ? collections : [null];
      const pages = Math.max(1, Math.ceil(context.maxPerStore / SHOPIFY_PAGE_SIZE));

      const results = await mapWithConcurrency(targets, 3, async (collection) => {
        const collected: RawScrapedItem[] = [];
        for (let page = 1; page <= pages; page += 1) {
          if (context.signal?.aborted) break;
          const { products } = await fetchCollectionPage(
            store.baseUrl,
            collection,
            page,
            context.signal
          );
          if (products.length === 0) break;
          for (const product of products) {
            const item = mapShopifyProduct(product, store);
            if (item) collected.push(item);
          }
        }
        return collected;
      });

      // Round-robin across collections so the store's catalog is represented by
      // every department instead of only the first (usually the biggest) one.
      const seen = new Set<string>();
      const merged: RawScrapedItem[] = [];
      const pools = results.map((items) => items.slice());
      let added = true;
      while (added && merged.length < context.maxPerStore) {
        added = false;
        for (const pool of pools) {
          if (merged.length >= context.maxPerStore) break;
          const next = pool.shift();
          if (!next) continue;
          added = true;
          if (seen.has(next.externalId)) continue;
          seen.add(next.externalId);
          merged.push(next);
        }
      }

      const unique = dedupeItems(merged).slice(0, context.maxPerStore);
      context.log(
        `  ${store.slug}: ${unique.length} productos relevantes de ${collections.length || 1} colección(es)`
      );
      return unique;
    },
  };
}
