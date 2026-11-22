import { load } from "cheerio";
import type { PanamaStoreConfig } from "@regateo/shared";
import { getFirecrawlClient } from "../firecrawl-client";
import { fetchText, mapWithConcurrency, postJson } from "../http";
import {
  dedupeItems,
  isRelevantElectronicsProduct,
  parsePriceToCents,
} from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * Panafoto (Magento 2) adapter.
 *
 * Primary source is the store's public Magento GraphQL endpoint, which returns
 * the same catalog the storefront uses: real final/regular prices, stock status
 * and the canonical `/<url_key>.html` product URL. When GraphQL is unavailable
 * (maintenance, WAF) we degrade to Firecrawl HTML and finally to plain HTTP +
 * Cheerio, which still exposes a handful of server-rendered `.product-item`
 * blocks.
 */

const GRAPHQL_CATEGORIES_QUERY = `
  query StoreCategories {
    categories(filters: { parent_id: { eq: "2" } }) {
      items { uid name url_path }
    }
  }
`;

const GRAPHQL_FULL_QUERY = `
  query FullCatalog($page: Int!, $pageSize: Int!) {
    products(search: "", currentPage: $page, pageSize: $pageSize) {
      total_count
      page_info { current_page total_pages }
      items {
        name
        sku
        url_key
        stock_status
        image { url }
        price_range {
          minimum_price {
            final_price { value currency }
            regular_price { value }
          }
        }
      }
    }
  }
`;

const GRAPHQL_SEARCH_QUERY = `
  query SearchProducts($term: String!, $pageSize: Int!) {
    products(search: $term, pageSize: $pageSize) {
      total_count
      items {
        name
        sku
        url_key
        stock_status
        image { url }
        price_range {
          minimum_price {
            final_price { value currency }
            regular_price { value }
          }
        }
      }
    }
  }
`;

const GRAPHQL_PRODUCTS_QUERY = `
  query CategoryProducts($uid: String!, $page: Int!, $pageSize: Int!) {
    products(pageSize: $pageSize, currentPage: $page, filter: { category_uid: { eq: $uid } }) {
      total_count
      page_info { current_page total_pages }
      items {
        name
        sku
        url_key
        stock_status
        image { url }
        price_range {
          minimum_price {
            final_price { value currency }
            regular_price { value }
          }
        }
      }
    }
  }
`;

/** Category url_paths worth indexing, in priority order for a comparison site. */
const WANTED_CATEGORIES = [
  "tv-y-video",
  "computo",
  "celulares-y-tablets",
  "audio",
  "linea-blanca",
  "electrodomesticos",
  "gaming",
  "smartwatches",
  "hogar-inteligente",
];

interface GraphqlCategoryResponse {
  data?: {
    categories?: {
      items?: Array<{ uid: string; name: string; url_path: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

interface GraphqlProductItem {
  name: string;
  sku: string;
  url_key: string;
  stock_status?: string | null;
  image?: { url?: string | null } | null;
  price_range?: {
    minimum_price?: {
      final_price?: { value?: number | null; currency?: string | null } | null;
      regular_price?: { value?: number | null } | null;
    } | null;
  } | null;
}

interface GraphqlProductsResponse {
  data?: {
    products?: {
      total_count?: number;
      page_info?: { current_page?: number; total_pages?: number };
      items?: GraphqlProductItem[];
    };
  };
  errors?: Array<{ message?: string }>;
}

function grapqhlUrl(store: PanamaStoreConfig): string {
  return `${store.baseUrl.replace(/\/+$/, "")}/graphql`;
}

async function graphql<T>(
  store: PanamaStoreConfig,
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const payload = await postJson<T>(
    grapqhlUrl(store),
    { query, variables },
    { retries: 1, signal }
  );
  const errors = (payload as { errors?: Array<{ message?: string }> }).errors;
  if (errors && errors.length > 0) {
    throw new Error(`GraphQL Panafoto: ${errors.map((error) => error.message).join("; ")}`);
  }
  return payload;
}

async function resolveCategoryUids(store: PanamaStoreConfig): Promise<Array<{ uid: string; path: string }>> {
  const response = await graphql<GraphqlCategoryResponse>(store, GRAPHQL_CATEGORIES_QUERY);
  const items = response.data?.categories?.items ?? [];
  const resolved: Array<{ uid: string; path: string }> = [];
  for (const wanted of WANTED_CATEGORIES) {
    const found = items.find((item) => item.url_path?.replace(/\/+$/, "") === wanted);
    if (found) resolved.push({ uid: found.uid, path: wanted });
  }
  return resolved;
}

function mapGraphqlItem(
  item: GraphqlProductItem,
  store: PanamaStoreConfig
): RawScrapedItem | null {
  const finalPrice = item.price_range?.minimum_price?.final_price?.value ?? null;
  const finalCents = parsePriceToCents(finalPrice);
  if (!finalCents) return null;

  const regularCents = parsePriceToCents(
    item.price_range?.minimum_price?.regular_price?.value ?? null
  );

  const base = store.baseUrl.replace(/\/+$/, "");
  const url = `${base}/${item.url_key.replace(/^\/+/, "")}.html`;

  const mapped: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: item.sku,
    title: item.name.trim(),
    sku: item.sku,
    productType: null,
    priceCents: finalCents,
    originalPriceCents: regularCents && regularCents > finalCents ? regularCents : null,
    currency: "USD",
    inStock: (item.stock_status ?? "IN_STOCK").toUpperCase() === "IN_STOCK",
    url,
    imageUrl: item.image?.url ?? null,
    rawSpecs: {
      platform: "magento",
      source: "graphql",
      sku: item.sku,
      stockStatus: item.stock_status ?? null,
    },
  };

  if (!isRelevantElectronicsProduct(mapped)) return null;
  return mapped;
}

/**
 * Cheerio parser for Magento category markup. Exported because it doubles as
 * the Firecrawl fallback and as the plain HTTP fallback.
 */
export function parsePanafotoHtml(
  html: string,
  store: PanamaStoreConfig,
  limit: number
): RawScrapedItem[] {
  const $ = load(html);
  const base = store.baseUrl.replace(/\/+$/, "");
  const items: RawScrapedItem[] = [];

  $("li.product-item").each((_, element) => {
    if (items.length >= limit) return false;
    const node = $(element);

    const link =
      node.find("a.product-item-link").attr("href") ??
      node.find("a.product-item-photo").attr("href") ??
      node.find("a").first().attr("href");
    if (!link) return;

    let url: string;
    try {
      url = new URL(link, base).toString();
    } catch {
      return;
    }

    const title =
      node.find(".product-item-link").text().trim() ||
      node.find("img.product-image-photo").attr("alt")?.trim() ||
      "";
    if (title.length < 4) return;

    const finalAttr =
      node.find("[data-price-type='finalPrice']").attr("data-price-amount") ??
      node.find(".price-wrapper[data-price-amount]").first().attr("data-price-amount");
    const oldAttr = node.find("[data-price-type='oldPrice']").attr("data-price-amount");
    const priceCents =
      parsePriceToCents(finalAttr ?? null) ?? parsePriceToCents(node.find(".price").first().text());
    if (!priceCents) return;

    const originalCents = parsePriceToCents(oldAttr ?? null);
    const externalId =
      node.find("[data-product-id]").attr("data-product-id") ??
      node.find("input[name='product']").attr("value") ??
      url.split("/").pop()?.replace(/\.html$/, "") ??
      url;

    const imageUrl =
      node.find("img.product-image-photo").attr("src") ??
      node.find("img").first().attr("data-src") ??
      null;

    const inStock = !/out-of-stock|unavailable|agotado/i.test(node.attr("class") ?? "");

    const mapped: RawScrapedItem = {
      storeSlug: store.slug,
      externalId,
      title,
      sku: null,
      productType: null,
      priceCents,
      originalPriceCents: originalCents && originalCents > priceCents ? originalCents : null,
      currency: "USD",
      inStock,
      url,
      imageUrl,
      rawSpecs: { platform: "magento", source: "html" },
    };

    if (isRelevantElectronicsProduct(mapped)) items.push(mapped);
  });

  return items;
}

/** Above this budget the full Magento catalog is indexed page by page. */
const FULL_CATALOG_THRESHOLD = 500;
const FULL_PAGE_SIZE = 100;
const FULL_PAGE_PAUSE_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Indexes the entire Panafoto catalog (`products(search: "", pageSize: 100)`),
 * which is what makes long-tail SKUs (e.g. Sony BRAVIA 8 65" · SKU 155144)
 * reachable instead of being cut off by a fixed budget.
 */
async function scrapeFullCatalog(
  store: PanamaStoreConfig,
  context: AdapterContext
): Promise<RawScrapedItem[]> {
  const collected: RawScrapedItem[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    if (context.signal?.aborted) break;
    let response: GraphqlProductsResponse | null = null;
    for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
      try {
        response = await graphql<GraphqlProductsResponse>(
          store,
          GRAPHQL_FULL_QUERY,
          { page, pageSize: FULL_PAGE_SIZE },
          context.signal
        );
      } catch (error) {
        context.log(
          `  panafoto catálogo página ${page} falló (intento ${attempt + 1}): ${(error as Error).message}`
        );
        await sleep(500 * (attempt + 1));
      }
    }
    if (!response) break;

    const products = response.data?.products;
    const items = products?.items ?? [];
    totalPages = products?.page_info?.total_pages ?? 1;

    for (const item of items) {
      const mapped = mapGraphqlItem(item, store);
      if (mapped) collected.push(mapped);
    }

    if (page % 10 === 0) {
      context.log(
        `  panafoto: ${page}/${totalPages} páginas · ${collected.length} relevantes de ${products?.total_count ?? "?"}`
      );
    }

    page += 1;
    if (collected.length >= context.maxPerStore) break;
    await sleep(FULL_PAGE_PAUSE_MS);
  } while (page <= totalPages);

  return dedupeItems(collected).slice(0, context.maxPerStore);
}

async function scrapeWithGraphql(
  store: PanamaStoreConfig,
  context: AdapterContext
): Promise<RawScrapedItem[]> {
  const categories = await resolveCategoryUids(store);
  if (categories.length === 0) throw new Error("No se resolvieron categorías por GraphQL");

  const perCategory = Math.max(6, Math.ceil(context.maxPerStore / categories.length) + 4);
  const pageSize = 24;
  const maxPages = Math.max(1, Math.ceil(perCategory / pageSize));

  const perCategoryItems = await mapWithConcurrency(categories, 3, async (category) => {
    const collected: RawScrapedItem[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      if (context.signal?.aborted) break;
      try {
        const response = await graphql<GraphqlProductsResponse>(
          store,
          GRAPHQL_PRODUCTS_QUERY,
          { uid: category.uid, page, pageSize },
          context.signal
        );
        const items = response.data?.products?.items ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          const mapped = mapGraphqlItem(item, store);
          if (mapped) collected.push(mapped);
        }
        const totalPages = response.data?.products?.page_info?.total_pages ?? 1;
        if (page >= totalPages) break;
      } catch (error) {
        context.log(
          `  panafoto/${category.path} página ${page} falló: ${(error as Error).message}`
        );
        break;
      }
    }
    return collected;
  });

  // Round-robin so every department is represented even with a small budget.
  const merged: RawScrapedItem[] = [];
  const seen = new Set<string>();
  const pools = perCategoryItems.map((items) => items.slice());
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

  return dedupeItems(merged).slice(0, context.maxPerStore);
}

async function scrapeWithHtml(
  store: PanamaStoreConfig,
  context: AdapterContext,
  useFirecrawl: boolean
): Promise<RawScrapedItem[]> {
  const client = getFirecrawlClient({ verbose: false });
  const paths = WANTED_CATEGORIES.slice(0, 4).map((path) => `/${path}.html`);
  const base = store.baseUrl.replace(/\/+$/, "");
  const collected: RawScrapedItem[] = [];

  for (const path of paths) {
    const url = `${base}${path}`;
    let html: string | null = null;

    if (useFirecrawl) {
      const result = await client.tryScrape(url);
      html = result?.html ?? result?.markdown ?? null;
    }
    if (!html) {
      try {
        html = await fetchText(url, { timeoutMs: 25_000, retries: 1, signal: context.signal });
      } catch (error) {
        context.log(`  panafoto${path} HTML falló: ${(error as Error).message}`);
        continue;
      }
    }

    const parsed = parsePanafotoHtml(html, store, context.maxPerStore);
    collected.push(...parsed);
    if (collected.length >= context.maxPerStore) break;
  }

  return dedupeItems(collected).slice(0, context.maxPerStore);
}

export function createPanafotoAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "magento-graphql",

    /**
     * Magento catalog search by model/SKU. Used to pull Panafoto's offer for
     * models already discovered in other stores (their category pages are too
     * deep to page through completely).
     */
    async searchByTerm(term, options = {}) {
      const pageSize = Math.min(10, Math.max(2, options.limit ?? 4));
      try {
        const response = await graphql<GraphqlProductsResponse>(
          store,
          GRAPHQL_SEARCH_QUERY,
          { term, pageSize }
        );
        const items = response.data?.products?.items ?? [];
        return items
          .map((entry) => mapGraphqlItem(entry, store))
          .filter((entry): entry is RawScrapedItem => entry !== null);
      } catch {
        return [];
      }
    },

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      try {
        if (context.maxPerStore > FULL_CATALOG_THRESHOLD) {
          const full = await scrapeFullCatalog(store, context);
          if (full.length > 0) {
            context.log(`  panafoto: ${full.length} productos del catálogo completo GraphQL`);
            return full;
          }
        }

        const items = await scrapeWithGraphql(store, context);
        if (items.length > 0) {
          context.log(`  panafoto: ${items.length} productos vía GraphQL`);
          return items;
        }
        context.log("  panafoto: GraphQL devolvió 0 productos, probando HTML");
      } catch (error) {
        context.log(`  panafoto GraphQL falló: ${(error as Error).message}`);
      }

      const htmlItems = await scrapeWithHtml(store, context, context.useFirecrawl);
      context.log(`  panafoto: ${htmlItems.length} productos vía HTML`);
      return htmlItems;
    },
  };
}
