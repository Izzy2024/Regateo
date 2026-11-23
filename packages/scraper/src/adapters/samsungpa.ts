import type { PanamaStoreConfig } from "@regateo/shared";
import { BROWSER_HEADERS, mapWithConcurrency, postJson, sleep } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * Samsung Shop Panamá (`https://shop.samsung.com/latin/pa`) — Magento 2.
 *
 * The storefront runs on Magento 2, so its public GraphQL endpoint returns the
 * whole official catalog (~538 products / 11 pages) with zero Firecrawl credits:
 *   POST https://shop.samsung.com/latin/pa/graphql   (header `Store: pa`)
 *
 * Samsung suffixes every regional SKU (`…-PA-1`, `…-PROMOS-PA`). Those suffixes
 * must be removed before matching, otherwise the same Galaxy A18 sold by
 * Multimax/Rodelag/Titán never merges with Samsung's own listing.
 */

const GRAPHQL_URL = "https://shop.samsung.com/latin/pa/graphql";
const PAGE_SIZE = 50;
const CONCURRENCY = 2;
const PAGE_PAUSE_MS = 150;
const MAX_PAGES = 40;

interface SamsungMoney {
  value?: number | null;
  currency?: string | null;
}

interface SamsungPriceRange {
  minimum_price?: {
    regular_price?: SamsungMoney | null;
    final_price?: SamsungMoney | null;
  } | null;
}

export interface SamsungProduct {
  id?: number | string | null;
  sku?: string | null;
  name?: string | null;
  url_key?: string | null;
  url_suffix?: string | null;
  stock_status?: string | null;
  image?: { url?: string | null } | null;
  price_range?: SamsungPriceRange | null;
}

interface SamsungPage {
  total_count?: number;
  page_info?: { current_page?: number; total_pages?: number } | null;
  items?: SamsungProduct[] | null;
}

interface GraphqlResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string }>;
}

const CATALOG_QUERY = `query SamsungCatalog($page: Int!, $pageSize: Int!) {
  products(filter: {}, pageSize: $pageSize, currentPage: $page) {
    total_count
    page_info { current_page total_pages }
    items {
      id
      sku
      name
      url_key
      url_suffix
      stock_status
      image { url }
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
        }
      }
    }
  }
}`;

/**
 * `SM-A185GZKPGTO-PA-1` → `SM-A185GZKPGTO`,
 * `UN65M80HAPXPA-PROMOS-PA` → `UN65M80HAPXPA`.
 * Only trailing region/promo segments are stripped, never real model digits.
 */
export function cleanSamsungSku(sku: string | null | undefined): string | null {
  let model = (sku ?? "").trim();
  if (!model) return null;

  for (;;) {
    const next = model.replace(/-(?:promos?|pa|panama|latam|usa|us)(?:-\d{1,2})?$/i, "");
    if (next === model) break;
    model = next.trim();
  }

  return model || null;
}

function samsungUrl(store: PanamaStoreConfig, product: SamsungProduct): string | null {
  const base = store.baseUrl.replace(/\/+$/, "");
  const urlKey = (product.url_key ?? "").trim();
  if (!urlKey) return null;
  const suffix = (product.url_suffix ?? "").trim() || ".html";
  return `${base}/${urlKey}${suffix.startsWith(".") ? suffix : `.${suffix}`}`;
}

/** Maps one Magento product into the normalized item consumed by ingestion. */
export function mapSamsungProduct(
  product: SamsungProduct | null | undefined,
  store: PanamaStoreConfig,
): RawScrapedItem | null {
  if (!product) return null;

  const title = (product.name ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 3) return null;

  const url = samsungUrl(store, product);
  if (!url) return null;

  const priceRange = product.price_range?.minimum_price ?? null;
  const priceCents = parsePriceToCents(priceRange?.final_price?.value ?? null);
  if (!priceCents) return null;

  const regularCents = parsePriceToCents(priceRange?.regular_price?.value ?? null);
  const externalId = String(product.sku ?? product.id ?? "").trim();
  if (!externalId) return null;

  const sku = (product.sku ?? "").trim() || null;
  const imageUrl = (product.image?.url ?? "").trim();

  const item: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: externalId.slice(0, 160),
    title,
    brand: "Samsung",
    modelNumber: cleanSamsungSku(sku),
    trustSkuModel: true,
    sku,
    gtin: null,
    productType: null,
    priceCents,
    originalPriceCents: regularCents && regularCents > priceCents ? regularCents : null,
    currency: "USD",
    inStock: (product.stock_status ?? "").toUpperCase() === "IN_STOCK",
    url,
    imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : null,
    rawSpecs: {
      platform: "magento-graphql",
      productId: product.id ?? null,
      sku,
      listPrice: priceRange?.regular_price?.value ?? null,
      stockStatus: product.stock_status ?? null,
      urlSuffix: product.url_suffix ?? null,
    },
  };

  if (!isRelevantElectronicsProduct(item)) return null;
  return item;
}

async function fetchSamsungPage(page: number, signal?: AbortSignal): Promise<SamsungPage | null> {
  const payload = await postJson<GraphqlResponse<{ products?: SamsungPage | null }>>(
    GRAPHQL_URL,
    { query: CATALOG_QUERY, variables: { page, pageSize: PAGE_SIZE } },
    {
      timeoutMs: 30_000,
      retries: 1,
      headers: {
        ...BROWSER_HEADERS,
        Accept: "application/json",
        "Content-Type": "application/json",
        Store: "pa",
      },
      signal,
    },
  );

  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  }
  return payload.data?.products ?? null;
}

export function createSamsungAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "magento-graphql",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const first = await fetchSamsungPage(1, context.signal);
      if (!first) {
        context.log("  samsungpa: GraphQL no devolvió catálogo");
        return [];
      }

      const totalHits = Number(first.total_count ?? 0);
      const totalPages = Math.max(
        1,
        Math.min(MAX_PAGES, Number(first.page_info?.total_pages ?? 1)),
      );
      context.log(`  samsungpa: ${totalHits} productos · ${totalPages} páginas`);

      const collected: RawScrapedItem[] = [];
      const push = (items: RawScrapedItem[]) => {
        for (const item of items) {
          if (collected.length >= context.maxPerStore) break;
          collected.push(item);
        }
      };

      push(
        (first.items ?? [])
          .map((product) => mapSamsungProduct(product, store))
          .filter((item): item is RawScrapedItem => item !== null),
      );

      const remainingPages: number[] = [];
      for (let page = 2; page <= totalPages; page += 1) remainingPages.push(page);

      const pages = Math.min(
        remainingPages.length,
        Math.max(0, Math.ceil(context.maxPerStore / PAGE_SIZE) + 2),
      );

      const results = await mapWithConcurrency(
        remainingPages.slice(0, pages),
        CONCURRENCY,
        async (page) => {
          if (context.signal?.aborted) return [];
          await sleep(PAGE_PAUSE_MS);
          try {
            const payload = await fetchSamsungPage(page, context.signal);
            return (payload?.items ?? [])
              .map((product) => mapSamsungProduct(product, store))
              .filter((item): item is RawScrapedItem => item !== null);
          } catch (error) {
            context.log(
              `  samsungpa: página ${page} falló (${error instanceof Error ? error.message : String(error)})`,
            );
            return [];
          }
        },
      );

      for (const batch of results) push(batch);

      const unique = dedupeItems(collected).slice(0, context.maxPerStore);
      context.log(`  samsungpa: ${unique.length} productos relevantes (GraphQL)`);
      return unique;
    },
  };
}
