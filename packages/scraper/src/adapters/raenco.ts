import type { PanamaStoreConfig } from "@regateo/shared";
import { BROWSER_HEADERS, mapWithConcurrency, postJson, sleep } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * Raenco (`https://www.raenco.com`) — Magento 2 with a public GraphQL endpoint.
 *
 * The full catalog is ~4,624 items (construction, roofing, tyres, hardware…),
 * so only the six verified electronics/appliances departments are queried, by
 * `category_uid`:
 *   MTI= Tecnología (851) · MjY= Línea Blanca (443) · MjI= Electrodomésticos (313)
 *   MjM= Audio y Video (250) · MzY= Abanicos (182) · MTgz Aires Acondicionados (88)
 *
 * ~2,127 relevant products in ≈43 requests of 50 items, zero Firecrawl credits.
 */

const GRAPHQL_URL = "https://www.raenco.com/graphql";
const PAGE_SIZE = 50;
const CONCURRENCY = 2;
const PAGE_PAUSE_MS = 150;
const MAX_PAGES_PER_DEPARTMENT = 30;

export interface RaencoDepartment {
  uid: string;
  label: string;
}

/** Base64 category uids verified against the live department listings. */
export const RAENCO_DEPARTMENTS: RaencoDepartment[] = [
  { uid: "MTI=", label: "Tecnología" },
  { uid: "MjY=", label: "Línea Blanca" },
  { uid: "MjI=", label: "Electrodomésticos" },
  { uid: "MjM=", label: "Audio y Video" },
  { uid: "MzY=", label: "Abanicos" },
  { uid: "MTgz", label: "Aires Acondicionados" },
];

interface MagentoMoney {
  value?: number | null;
  currency?: string | null;
}

interface MagentoPriceRange {
  minimum_price?: {
    regular_price?: MagentoMoney | null;
    final_price?: MagentoMoney | null;
  } | null;
}

export interface RaencoProduct {
  id?: number | string | null;
  sku?: string | null;
  name?: string | null;
  url_key?: string | null;
  url_suffix?: string | null;
  stock_status?: string | null;
  image?: { url?: string | null } | null;
  price_range?: MagentoPriceRange | null;
}

interface MagentoPage {
  total_count?: number;
  page_info?: { current_page?: number; total_pages?: number } | null;
  items?: RaencoProduct[] | null;
}

interface GraphqlResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string }>;
}

const DEPARTMENT_QUERY = `query RaencoDept($uid: String!, $page: Int!, $pageSize: Int!) {
  products(filter: { category_uid: { eq: $uid } }, pageSize: $pageSize, currentPage: $page) {
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

/** Raenco's Magento placeholder is useless for a comparison site. */
function raencoImage(product: RaencoProduct): string | null {
  const url = (product.image?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/placeholder\/image\.jpg/i.test(url)) return null;
  return url;
}

function raencoUrl(store: PanamaStoreConfig, product: RaencoProduct): string | null {
  const base = store.baseUrl.replace(/\/+$/, "");
  const urlKey = (product.url_key ?? "").trim();
  if (!urlKey) return null;
  const suffix = (product.url_suffix ?? "").trim() || ".html";
  return `${base}/${urlKey}${suffix.startsWith(".") ? suffix : `.${suffix}`}`;
}

/** Maps one Magento product into the normalized item consumed by ingestion. */
export function mapRaencoProduct(
  product: RaencoProduct | null | undefined,
  store: PanamaStoreConfig,
  department: string | null = null,
): RawScrapedItem | null {
  if (!product) return null;

  const title = (product.name ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 3) return null;

  const url = raencoUrl(store, product);
  if (!url) return null;

  const priceRange = product.price_range?.minimum_price ?? null;
  const priceCents = parsePriceToCents(priceRange?.final_price?.value ?? null);
  if (!priceCents) return null;

  const regularCents = parsePriceToCents(priceRange?.regular_price?.value ?? null);
  const sku = (product.sku ?? "").trim() || null;
  const externalId = String(sku ?? product.id ?? "").trim();
  if (!externalId) return null;

  const item: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: externalId.slice(0, 160),
    title,
    // Raenco SKUs are internal (`2930457`), never a manufacturer model code.
    trustSkuModel: false,
    modelNumber: null,
    sku,
    gtin: null,
    productType: department,
    priceCents,
    originalPriceCents: regularCents && regularCents > priceCents ? regularCents : null,
    currency: "USD",
    inStock: (product.stock_status ?? "").toUpperCase() === "IN_STOCK",
    url,
    imageUrl: raencoImage(product),
    rawSpecs: {
      platform: "magento-graphql",
      productId: product.id ?? null,
      sku,
      department,
      listPrice: priceRange?.regular_price?.value ?? null,
      stockStatus: product.stock_status ?? null,
    },
  };

  if (!isRelevantElectronicsProduct(item)) return null;
  return item;
}

async function fetchDepartmentPage(
  department: RaencoDepartment,
  page: number,
  signal?: AbortSignal,
): Promise<MagentoPage | null> {
  const payload = await postJson<GraphqlResponse<{ products?: MagentoPage | null }>>(
    GRAPHQL_URL,
    {
      query: DEPARTMENT_QUERY,
      variables: { uid: department.uid, page, pageSize: PAGE_SIZE },
    },
    {
      timeoutMs: 30_000,
      retries: 1,
      headers: {
        ...BROWSER_HEADERS,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal,
    },
  );

  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  }
  return payload.data?.products ?? null;
}

interface DepartmentRun {
  items: RawScrapedItem[];
  pages: number;
}

async function scrapeDepartment(
  store: PanamaStoreConfig,
  department: RaencoDepartment,
  options: { maxPages: number; maxItems: number; pauseMs: number; signal?: AbortSignal },
): Promise<DepartmentRun> {
  const collected: RawScrapedItem[] = [];
  const seen = new Set<string>();
  let pages = 0;

  for (let page = 1; page <= options.maxPages; page += 1) {
    if (options.signal?.aborted) break;
    if (page > 1 && options.pauseMs > 0) await sleep(options.pauseMs);

    let payload: MagentoPage | null;
    try {
      payload = await fetchDepartmentPage(department, page, options.signal);
    } catch {
      break;
    }

    const items = payload?.items ?? [];
    if (items.length === 0) break;
    pages += 1;

    for (const product of items) {
      if (collected.length >= options.maxItems) break;
      const item = mapRaencoProduct(product, store, department.label);
      if (!item || seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      collected.push(item);
    }

    const totalPages = Number(payload?.page_info?.total_pages ?? 0);
    if (totalPages > 0 && page >= totalPages) break;
    if (collected.length >= options.maxItems) break;
  }

  return { items: collected, pages };
}

/** Round-robin merge so one big department never eats the whole budget. */
function interleave(pools: RawScrapedItem[][], max: number): RawScrapedItem[] {
  const merged: RawScrapedItem[] = [];
  const seen = new Set<string>();
  const queues = pools.map((pool) => pool.slice());
  let added = true;

  while (added && merged.length < max) {
    added = false;
    for (const queue of queues) {
      if (merged.length >= max) break;
      const next = queue.shift();
      if (!next) continue;
      added = true;
      if (seen.has(next.externalId)) continue;
      seen.add(next.externalId);
      merged.push(next);
    }
  }

  return merged;
}

export function createRaencoAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "magento-graphql",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      // Small budget: one page per department keeps every shelf represented.
      const smallBudget = context.maxPerStore <= 250;
      const perDepartmentBudget = smallBudget
        ? PAGE_SIZE
        : Math.ceil(context.maxPerStore / RAENCO_DEPARTMENTS.length) + PAGE_SIZE;

      const runs = await mapWithConcurrency(
        RAENCO_DEPARTMENTS,
        smallBudget ? RAENCO_DEPARTMENTS.length : CONCURRENCY,
        (department) =>
          scrapeDepartment(store, department, {
            maxPages: smallBudget ? 1 : MAX_PAGES_PER_DEPARTMENT,
            maxItems: perDepartmentBudget,
            pauseMs: PAGE_PAUSE_MS,
            signal: context.signal,
          }),
      );

      const pools = runs.map((run) => run.items);
      const totalPages = runs.reduce((sum, run) => sum + run.pages, 0);
      const totalItems = pools.reduce((sum, pool) => sum + pool.length, 0);
      context.log(
        `  raenco: ${RAENCO_DEPARTMENTS.length} departamentos · ${totalPages} páginas · ${totalItems} relevantes`,
      );

      const unique = dedupeItems(interleave(pools, context.maxPerStore)).slice(
        0,
        context.maxPerStore,
      );
      context.log(`  raenco: ${unique.length} productos relevantes (GraphQL por departamento)`);
      return unique;
    },
  };
}
