import type { PanamaStoreConfig } from "@regateo/shared";
import { getFirecrawlClient } from "../firecrawl-client";
import { fetchJson, mapWithConcurrency } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * PTYTEC (`https://www.ptytec.com`) — Vue SPA served by nginx on top of a
 * Laravel catalog API at `https://webapi.ptytec.com/api`.
 *
 * Discovered from `assets/js/index-*.js` + `productApi-*.js`:
 *   GET /category                     → category tree
 *   GET /product/search?category=ID   → paginated products (24/page)
 *   GET /product/{id}                 → product detail
 *
 * Prices come as strings with member/offer variants, so we take the public
 * price and only use `offer_price` when it is a real discount.
 */

const DEFAULT_API_URL = "https://webapi.ptytec.com/api";
const PAGE_SIZE = 24;
const MAX_CATEGORIES = 14;
/** Above this budget the whole Laravel catalog is paged (≈5.8k products). */
const FULL_CATALOG_THRESHOLD = 500;
const FULL_CONCURRENCY = 4;
const FULL_PAGE_PAUSE_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PRIORITY_KEYWORDS = [
  "computadoras",
  "componentes",
  "monitores",
  "periféricos",
  "electronic",
  "electrónic",
  "gaming",
  "redes",
  "impresoras",
  "proyectores",
  "ups",
  "hogar",
  "seguridad",
  "software",
  "punto de venta",
];

interface PtytecCategory {
  id: number;
  name: string;
  pid?: number;
  level?: number;
}

interface PtytecProduct {
  id: number;
  code?: string | null;
  model?: string | null;
  name?: string | null;
  regular_price?: string | number | null;
  price?: string | number | null;
  price_public?: string | number | null;
  offer_price?: string | number | null;
  price_offer?: string | number | null;
  offer_percent?: number | null;
  stock?: number | null;
  image?: string | null;
  image_url?: string | null;
  main_image_url?: string | null;
  category_id?: number | null;
  category_name?: string | null;
}

interface PtytecResponse<T> {
  status?: string;
  code?: number;
  message?: string;
  data?: T;
}

interface PtytecProductList {
  products?: PtytecProduct[];
  meta?: { current_page?: number; last_page?: number; total?: number };
}

function apiBase(): string {
  return (process.env.PTYTEC_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function categoryScore(name: string): number {
  const normalized = normalize(name);
  const index = PRIORITY_KEYWORDS.findIndex((keyword) => normalized.includes(normalize(keyword)));
  return index === -1 ? -1 : PRIORITY_KEYWORDS.length - index;
}

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const payload = await fetchJson<PtytecResponse<T>>(`${apiBase()}/${path.replace(/^\/+/, "")}`, {
      timeoutMs: 25_000,
      retries: 1,
      headers: {
        Accept: "application/json",
        Referer: "https://www.ptytec.com/",
      },
    });
    if (payload.code !== undefined && payload.code !== 0) return null;
    return payload.data ?? null;
  } catch {
    return null;
  }
}

export function mapPtytecProduct(
  product: PtytecProduct,
  store: PanamaStoreConfig
): RawScrapedItem | null {
  const title = product.name?.trim();
  if (!title || title.length < 3 || !product.id) return null;

  const publicCents =
    parsePriceToCents(product.price_public ?? null) ??
    parsePriceToCents(product.price ?? null);
  const offerCents =
    parsePriceToCents(product.offer_price ?? null) ??
    parsePriceToCents(product.price_offer ?? null);
  const regularCents = parsePriceToCents(product.regular_price ?? null);

  const priceCents =
    offerCents && (!publicCents || offerCents < publicCents)
      ? offerCents
      : (publicCents ?? regularCents);
  if (!priceCents) return null;

  const originalCents =
    [publicCents, regularCents]
      .filter((cents): cents is number => typeof cents === "number" && cents > priceCents)
      .sort((a, b) => b - a)[0] ?? null;

  const base = store.baseUrl.replace(/\/+$/, "");
  const inStock = typeof product.stock === "number" ? product.stock > 0 : true;

  const mapped: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: String(product.id),
    title,
    brand: null,
    modelNumber: product.model?.trim() || null,
    sku: product.code?.trim() || null,
    productType: product.category_name?.trim() || null,
    priceCents,
    originalPriceCents: originalCents,
    currency: "USD",
    inStock,
    url: `${base}/product/${product.id}`,
    imageUrl: product.image_url ?? product.main_image_url ?? product.image ?? null,
    rawSpecs: {
      platform: "ptytec-api",
      model: product.model ?? null,
      code: product.code ?? null,
      storeCategory: product.category_name ?? null,
      categoryId: product.category_id ?? null,
      stock: product.stock ?? null,
      offerPercent: product.offer_percent ?? null,
    },
  };

  if (!isRelevantElectronicsProduct(mapped)) return null;
  return mapped;
}

/**
 * Full-catalog mode: walks `/product/search?page=N` (the endpoint ignores
 * category when omitted and returns the complete catalog, 24 items/page).
 */
async function pageFullCatalog(
  store: PanamaStoreConfig,
  maxItems: number,
  context: AdapterContext
): Promise<RawScrapedItem[]> {
  const collected = new Map<string, RawScrapedItem>();

  const ingestList = (list: PtytecProductList | null): void => {
    for (const product of list?.products ?? []) {
      const mapped = mapPtytecProduct(product, store);
      if (mapped) collected.set(mapped.externalId, mapped);
    }
  };

  const first = await apiGet<PtytecProductList>("product/search?page=1");
  ingestList(first);
  const lastPage = first?.meta?.last_page ?? 1;
  const total = first?.meta?.total ?? collected.size;

  let page = 2;
  while (page <= lastPage && collected.size < maxItems) {
    const batch = Array.from({ length: FULL_CONCURRENCY }, (_, index) => page + index).filter(
      (candidate) => candidate <= lastPage
    );
    const lists = await Promise.all(
      batch.map((candidate) => apiGet<PtytecProductList>(`product/search?page=${candidate}`))
    );
    for (const list of lists) ingestList(list);

    page += FULL_CONCURRENCY;
    if (page % 40 === 2) {
      context.log(`  ptytec: ${Math.min(page - 1, lastPage)}/${lastPage} páginas · ${collected.size} relevantes de ${total}`);
    }
    await sleep(FULL_PAGE_PAUSE_MS);
  }

  return [...collected.values()].slice(0, maxItems);
}

export function createPtytecAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "json-api",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      // ---- Full catalog mode: page the whole Laravel catalog. --------------
      if (context.maxPerStore > FULL_CATALOG_THRESHOLD) {
        const full = await pageFullCatalog(store, context.maxPerStore, context);
        const unique = dedupeItems(full).slice(0, context.maxPerStore);
        context.log(`  ptytec: ${unique.length} productos relevantes (catálogo completo API)`);
        return unique;
      }

      const categoriesData = await apiGet<{ categories?: PtytecCategory[] }>("category");
      const categories = (categoriesData?.categories ?? [])
        .map((category) => ({ category, score: categoryScore(category.name) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_CATEGORIES)
        .map((entry) => entry.category);

      const collected: RawScrapedItem[] = [];

      if (categories.length > 0) {
        const pagesPerCategory = Math.max(
          1,
          Math.ceil(context.maxPerStore / categories.length / PAGE_SIZE)
        );

        const pools = await mapWithConcurrency(categories, 3, async (category) => {
          const pool: RawScrapedItem[] = [];
          for (let page = 1; page <= pagesPerCategory; page += 1) {
            const list = await apiGet<PtytecProductList>(
              `product/search?category=${category.id}&page=${page}`
            );
            const products = list?.products ?? [];
            if (products.length === 0) break;

            for (const product of products) {
              const mapped = mapPtytecProduct(product, store);
              if (mapped) pool.push(mapped);
            }

            const lastPage = list?.meta?.last_page ?? 1;
            if (page >= lastPage) break;
          }
          return pool;
        });

        const seen = new Set<string>();
        const queues = pools.map((pool) => pool.slice());
        let added = true;
        while (added && collected.length < context.maxPerStore) {
          added = false;
          for (const queue of queues) {
            if (collected.length >= context.maxPerStore) break;
            const next = queue.shift();
            if (!next) continue;
            added = true;
            if (seen.has(next.externalId)) continue;
            seen.add(next.externalId);
            collected.push(next);
          }
        }

        context.log(
          `  ptytec: ${categories.length} categorías API (${categories
            .slice(0, 4)
            .map((category) => category.name)
            .join(", ")}…)`
        );
      }

      // Fallback: Firecrawl for the SPA shell (rarely has product data, but it
      // keeps the pipeline alive if the JSON API changes or blocks us).
      if (collected.length === 0 && context.useFirecrawl) {
        const client = getFirecrawlClient({ verbose: false });
        const result = await client.tryScrape(`${store.baseUrl.replace(/\/+$/, "")}/`);
        const html = result?.html ?? result?.markdown ?? null;
        if (html) {
          context.log("  ptytec: API sin datos, Firecrawl no expone catálogo en el shell");
        }
      }

      const unique = dedupeItems(collected).slice(0, context.maxPerStore);
      context.log(`  ptytec: ${unique.length} productos del API`);
      return unique;
    },
  };
}
