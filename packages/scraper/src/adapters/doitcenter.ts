import type { PanamaStoreConfig } from "@regateo/shared";
import { getFirecrawlClient } from "../firecrawl-client";
import { BROWSER_HEADERS, fetchJson, fetchText, mapWithConcurrency } from "../http";
import {
  dedupeItems,
  isRelevantElectronicsProduct,
  looksLikeModelToken,
  parsePriceToCents,
} from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";
import { parseGenericStoreHtml } from "./firecrawl-store";

/**
 * Do it Center (`https://www.doitcenter.com.pa`) — Magento 2 backend + Next.js
 * storefront.
 *
 * The Next.js pages are server-side rendered with the exact Magento GraphQL
 * payload inside `__NEXT_DATA__`, and Next.js exposes that same payload as JSON
 * at `/_next/data/<buildId>/<path>.json?page=N`. We use that endpoint (≈85 KB
 * instead of ≈500 KB of HTML) and fall back to rendering with Firecrawl when the
 * payload or build id is missing.
 */

interface DoitMoney {
  value?: number | string | null;
  currency?: string | null;
}

interface DoitPriceRange {
  minimum_price?: {
    final_price?: DoitMoney | null;
    regular_price?: DoitMoney | null;
    discount?: { amount_off?: number | null } | null;
  } | null;
}

interface DoitProduct {
  __typename?: string;
  id?: number | string;
  name?: string;
  sku?: string | null;
  marca_text?: string | null;
  url_key?: string;
  url_suffix?: string | null;
  stock_status?: string | null;
  price_range?: DoitPriceRange | null;
  small_image?: { url?: string | null; label?: string | null } | null;
}

interface DoitNextData {
  buildId?: string;
  props?: {
    pageProps?: {
      renderType?: string;
      url_path?: string;
      totalPages?: number;
      currentPage?: number;
      categoryData?: {
        products?: {
          items?: DoitProduct[];
          total_count?: number;
          page_info?: { total_pages?: number; current_page?: number };
        };
      };
    };
  };
}

interface CategoryTarget {
  path: string;
  score: number;
}

/** Electronics departments that exist on the store today, as a fallback. */
const DEFAULT_CATEGORIES = [
  "/categorias/electronica/televisores",
  "/categorias/electronica/tecnologia",
  "/categorias/electronica/equipos-de-sonido",
  "/categorias/electronica/consolas-y-video-juegos",
  "/categorias/linea-blanca/refrigeradoras",
  "/categorias/linea-blanca/lavadoras",
  "/categorias/linea-blanca/secadoras",
  "/categorias/linea-blanca/estufas",
  "/categorias/linea-blanca/aires-acondicionados",
  "/categorias/cocina/electrodomesticos",
  "/categorias/abanicos/de-techo",
];

const PRIORITY_SLUGS = [
  "televisores",
  "tecnologia",
  "computadoras",
  "laptops",
  "celulares",
  "audio",
  "equipos-de-sonido",
  "consolas",
  "video-juegos",
  "refrigeradoras",
  "neveras",
  "lavadoras",
  "secadoras",
  "estufas",
  "aires-acondicionados",
  "electrodomesticos",
  "microondas",
  "abanicos",
];

const MAX_CATEGORIES = 8;
/** Above this budget the whole electronics/appliances catalog is indexed. */
const FULL_CATALOG_THRESHOLD = 500;
const FULL_PAGE_PAUSE_MS = 180;

/**
 * Parents aggregate their children on this storefront (`/categorias/electronica`
 * already contains televisores, audio, tecnología y accesorios), so paging the
 * parents avoids duplicate requests while still covering every department.
 */
const FULL_CATALOG_CATEGORIES = [
  "/categorias/electronica",
  "/categorias/linea-blanca",
  "/categorias/cocina/electrodomesticos",
  "/categorias/abanicos",
  "/categorias/electricidad/audio-y-video",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scoreCategory(path: string): number {
  const slug = path.toLowerCase();
  const index = PRIORITY_SLUGS.findIndex((candidate) => slug.includes(candidate));
  return index === -1 ? -1 : PRIORITY_SLUGS.length - index;
}

/**
 * Returns `/categorias/...` links from the storefront nav, prioritized by
 * department relevance. Only leaf-ish paths (max 3 segments) are kept.
 */
export function discoverDoitCenterCategories(html: string): CategoryTarget[] {
  const hrefs = [...html.matchAll(/href="(\/categorias\/[a-z0-9\-/]+)"/gi)].map(
    (match) => match[1]
  );
  const unique = new Map<string, CategoryTarget>();

  for (const path of hrefs) {
    const clean = path.replace(/\/+$/, "");
    const segments = clean.split("/").filter(Boolean);
    if (segments.length < 2 || segments.length > 3) continue;
    const score = scoreCategory(clean);
    if (score <= 0) continue;
    if (!unique.has(clean)) unique.set(clean, { path: clean, score });
  }

  return [...unique.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function extractNextData(html: string): DoitNextData | null {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as DoitNextData;
  } catch {
    return null;
  }
}

/**
 * Do it Center SKUs are `{3-digit department prefix}{manufacturer model}`, e.g.
 * `51858Q6QV` → `58Q6QV`, `502WT02409D` → `WT02409D`, `517HLAW142` → `HLAW142`.
 * The raw SKU must not be used as a model (it would never match another store),
 * so we strip the department prefix and stop trusting the SKU afterwards.
 */
export function deriveDoitCenterModel(sku: string | null | undefined): string | null {
  const clean = sku?.trim().toUpperCase();
  if (!clean) return null;
  const match = clean.match(/^\d{3}([A-Z0-9][A-Z0-9\-./]{2,})$/);
  const candidate = match?.[1];
  if (!candidate) return null;
  return looksLikeModelToken(candidate) ? candidate : null;
}

function moneyCents(money: DoitMoney | null | undefined): number | null {
  if (!money) return null;
  return parsePriceToCents(money.value ?? null);
}

export function mapDoitCenterProduct(
  product: DoitProduct,
  store: PanamaStoreConfig
): RawScrapedItem | null {
  const title = product.name?.trim();
  if (!title || title.length < 3) return null;

  const priceCents = moneyCents(product.price_range?.minimum_price?.final_price);
  if (!priceCents) return null;

  const regularCents = moneyCents(product.price_range?.minimum_price?.regular_price);
  const urlKey = product.url_key?.trim();
  if (!urlKey) return null;

  const base = store.baseUrl.replace(/\/+$/, "");
  const suffix = product.url_suffix?.trim() || "";
  const url = `${base}/productos/${urlKey}${suffix && !urlKey.endsWith(suffix) ? suffix : ""}`;

  const externalId = String(product.sku ?? product.id ?? urlKey).slice(0, 160);
  const stockStatus = (product.stock_status ?? "UNKNOWN").toUpperCase();
  const modelNumber = deriveDoitCenterModel(product.sku);

  const mapped: RawScrapedItem = {
    storeSlug: store.slug,
    externalId,
    title,
    brand: product.marca_text?.trim() || null,
    modelNumber,
    trustSkuModel: false,
    sku: product.sku ?? null,
    productType: null,
    priceCents,
    originalPriceCents: regularCents && regularCents > priceCents ? regularCents : null,
    currency: "USD",
    inStock: stockStatus !== "OUT_OF_STOCK",
    url,
    imageUrl: product.small_image?.url ?? null,
    rawSpecs: {
      platform: "magento-nextjs",
      urlKey,
      productId: product.id ?? null,
      storeSku: product.sku ?? null,
      stockStatus,
    },
  };

  if (!isRelevantElectronicsProduct(mapped)) return null;
  return mapped;
}

function productsFromNextData(data: DoitNextData | null): DoitProduct[] {
  return data?.props?.pageProps?.categoryData?.products?.items ?? [];
}

async function fetchCategoryJson(
  base: string,
  buildId: string,
  path: string,
  page: number,
  signal?: AbortSignal
): Promise<DoitNextData | null> {
  const cleanPath = path.replace(/^\/+/, "");
  const url = `${base}/_next/data/${buildId}/${cleanPath}.json${page > 1 ? `?page=${page}` : ""}`;
  try {
    return await fetchJson<DoitNextData>(url, {
      timeoutMs: 25_000,
      retries: 0,
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    return null;
  }
}

async function fetchCategoryHtml(
  base: string,
  path: string,
  page: number,
  signal?: AbortSignal
): Promise<DoitNextData | null> {
  const url = `${base}${path}${page > 1 ? `?page=${page}` : ""}`;
  try {
    const html = await fetchText(url, {
      timeoutMs: 30_000,
      retries: 1,
      headers: BROWSER_HEADERS,
      signal,
    });
    return extractNextData(html);
  } catch {
    return null;
  }
}

export function createDoitCenterAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "magento-graphql",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const base = store.baseUrl.replace(/\/+$/, "");
      const collected: RawScrapedItem[] = [];

      // 1. Discover categories + build id from the storefront home page.
      let buildId = "";
      let categories: CategoryTarget[] = [];

      try {
        const home = await fetchText(`${base}/`, {
          timeoutMs: 30_000,
          retries: 1,
          headers: BROWSER_HEADERS,
        });
        const homeData = extractNextData(home);
        buildId = homeData?.buildId ?? "";
        categories = discoverDoitCenterCategories(home).slice(0, MAX_CATEGORIES);
      } catch (error) {
        context.log(`  doitcenter: home no disponible (${(error as Error).message})`);
      }

      if (categories.length === 0) {
        categories = DEFAULT_CATEGORIES.map((path) => ({ path, score: 1 }));
      }

      const fullMode = context.maxPerStore > FULL_CATALOG_THRESHOLD;
      if (fullMode) {
        categories = FULL_CATALOG_CATEGORIES.map((path) => ({ path, score: 1 }));
      }

      const pagesPerCategory = fullMode
        ? Number.POSITIVE_INFINITY
        : Math.max(2, Math.ceil(context.maxPerStore / categories.length / 24) + 1);

      // 2. Pull the Next.js data payloads (GraphQL response) per category.
      const pools = await mapWithConcurrency(categories, fullMode ? 2 : 3, async (category) => {
        const pool: RawScrapedItem[] = [];
        for (let page = 1; page <= pagesPerCategory; page += 1) {
          if (context.signal?.aborted) break;
          let data = buildId
            ? await fetchCategoryJson(base, buildId, category.path, page, context.signal)
            : null;

          if (!data || productsFromNextData(data).length === 0) {
            // Build id rotated or data route blocked: read the SSR HTML instead.
            data = await fetchCategoryHtml(base, category.path, page, context.signal);
            if (data?.buildId) buildId = data.buildId;
          }

          const products = productsFromNextData(data);
          if (products.length === 0) break;

          for (const product of products) {
            const mapped = mapDoitCenterProduct(product, store);
            if (mapped) pool.push(mapped);
          }

          const totalPages =
            data?.props?.pageProps?.categoryData?.products?.page_info?.total_pages ??
            data?.props?.pageProps?.totalPages ??
            1;
          if (page >= totalPages) break;
          if (fullMode) await sleep(FULL_PAGE_PAUSE_MS);
        }
        if (fullMode) {
          context.log(`  doitcenter ${category.path}: ${pool.length} productos (${pagesPerCategory === Infinity ? "todas las páginas" : ""})`);
        }
        return pool;
      });

      // 3. Round-robin so every department is represented.
      const seen = new Set<string>();
      const merged: RawScrapedItem[] = [];
      const queues = pools.map((pool) => pool.slice());
      let added = true;
      while (added && merged.length < context.maxPerStore) {
        added = false;
        for (const queue of queues) {
          if (merged.length >= context.maxPerStore) break;
          const next = queue.shift();
          if (!next) continue;
          added = true;
          if (seen.has(next.externalId)) continue;
          seen.add(next.externalId);
          merged.push(next);
        }
      }
      collected.push(...merged);

      // 4. Firecrawl fallback when the JSON/SSR path yields nothing.
      if (collected.length === 0 && context.useFirecrawl) {
        const client = getFirecrawlClient({ verbose: false });
        for (const category of categories.slice(0, 3)) {
          const result = await client.tryScrape(`${base}${category.path}`);
          const html = result?.html ?? result?.markdown ?? null;
          if (!html) continue;

          const data = extractNextData(html);
          const products = productsFromNextData(data);
          if (products.length > 0) {
            for (const product of products) {
              const mapped = mapDoitCenterProduct(product, store);
              if (mapped) collected.push(mapped);
            }
          } else {
            collected.push(...parseGenericStoreHtml(html, store, context.maxPerStore));
          }
          if (collected.length >= context.maxPerStore) break;
        }
      }

      const unique = dedupeItems(collected).slice(0, context.maxPerStore);
      context.log(
        `  doitcenter: ${unique.length} productos de ${categories.length} categorías${
          buildId ? "" : " (sin buildId)"
        }`
      );
      return unique;
    },
  };
}
