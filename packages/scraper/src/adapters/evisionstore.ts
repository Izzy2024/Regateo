import type { PanamaStoreConfig } from "@regateo/shared";
import { load } from "cheerio";
import { BROWSER_HEADERS, fetchText, HttpError, postJson, sleep } from "../http";
import {
  dedupeItems,
  extractPanamaBrand,
  isRelevantElectronicsProduct,
  parsePriceToCents,
} from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * eVision Store (`https://www.evisionstore.com`) — Botble eCommerce with a
 * public **Algolia Search-Only index** (`~1,394` products, no Firecrawl credits).
 *
 * Discovered from the storefront HTML:
 *   `<script>algolia = { app: '81JEEVCUGY', key: 'dc64…' };</script>`
 *
 * The index exposes `categories` as a facet, and every one of them holds fewer
 * than 1,000 hits, so walking the facet list (instead of one unfiltered query
 * capped at 1,000 by Algolia) is what lets us capture the whole catalog.
 *
 * Two verified rules drive the mapping:
 *   1. Product URLs are `${baseUrl}/products/<slug>` — `hit.url` and
 *      `${baseUrl}/<slug>` both return **HTTP 404**.
 *   2. `price_numeric` is the current price; `price` is the list price.
 */

export interface EvisionAlgoliaConfig {
  appId: string;
  apiKey: string;
  indexName: string;
}

/** Verified fallback values (extracted again from the homepage on every run). */
export const EVISION_DEFAULT_ALGOLIA: EvisionAlgoliaConfig = {
  appId: "81JEEVCUGY",
  apiKey: "dc64b0a83549338fac7ed0336e83215b",
  indexName: "products",
};

/**
 * The index exposes `categories` as a facet with ~137 values, but most of them
 * are children of a handful of roots. Walking every facet would multiply
 * requests for redundant subsets, so we only walk the root shelves (all of them
 * hold fewer than the 1,000 hits Algolia allows per query) plus one unfiltered
 * sweep of the 100 pages the Search-Only key paginates.
 */

/** The Search-Only key accepts at most 10 hits per query. */
const HITS_PER_PAGE = 10;
/** Algolia refuses to page past hit 1,000 (100 pages) on a single query. */
const MAX_PAGES_PER_CATEGORY = 100;
/** Above this budget the catalog is captured end-to-end. */
const FULL_CATALOG_THRESHOLD = 250;
/** Verified root shelves of the store (see the brief), priority order. */
const ROOT_CATEGORIES = [
  "Televisores y Accesorios",
  "Línea Blanca",
  "Audio",
  "Electrodomésticos",
  "Cómputo",
  "Celulares y Tablets",
  "Video Juegos",
  "Fotografía",
  "Impresión",
  "Accesorios",
  "Cuidado Personal",
  "Redes y Wi-Fi",
];
/** Minimum gap between two Algolia requests (verified safe pacing: no 429). */
const ALGOLIA_MIN_INTERVAL_MS = 150;
const ALGOLIA_MAX_ATTEMPTS = 5;
/** Small-budget mode: a few pages per priority shelf. */
const SMALL_BUDGET_CATEGORIES = 8;
const SMALL_BUDGET_MIN_PAGES = 2;
const SMALL_BUDGET_MAX_PAGES = 4;
/** Hard stop so a facet explosion can never turn into an endless run. */
const MAX_TOTAL_REQUESTS = 400;
/** HTML fallback (`/products?page=N`, 12 cards per page). */
const HTML_PAGE_SIZE = 12;
const MAX_HTML_PAGES = 120;
const HTML_PAGE_PAUSE_MS = 140;
const MAX_EXTERNAL_ID_LENGTH = 160;

interface EvisionStockStatus {
  value?: string | null;
  label?: string | null;
}

export interface EvisionAlgoliaHit {
  objectID?: string | number | null;
  name?: string | null;
  slug?: string | null;
  url?: string | null;
  sku?: string | null;
  model_number?: string | null;
  price?: number | string | null;
  sale_price?: number | string | null;
  price_numeric?: number | string | null;
  is_on_sale?: boolean | null;
  image?: string | null;
  brand?: string | null;
  categories?: string[] | null;
  specs?: string[] | null;
  spec_facets?: Record<string, string> | null;
  stock_status?: EvisionStockStatus | string | null;
  status?: EvisionStockStatus | string | null;
}

interface AlgoliaQueryResponse {
  hits?: EvisionAlgoliaHit[];
  nbHits?: number;
  nbPages?: number;
  page?: number;
  facets?: Record<string, Record<string, number>>;
}

interface FacetShelf {
  name: string;
  count: number;
}

/* -------------------------------------------------------------------------- */
/* Algolia discovery                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Reads `algolia = { app: '…', key: '…' }` from any storefront page and falls
 * back to the verified defaults when the snippet is missing or malformed.
 */
export function extractEvisionAlgoliaConfig(html: string | null | undefined): EvisionAlgoliaConfig {
  if (!html) return { ...EVISION_DEFAULT_ALGOLIA };

  const block = html.match(/algolia\s*=\s*\{([^}]{0,400})\}/i)?.[1] ?? "";
  const app = block.match(/app\s*:\s*['"]([A-Z0-9]{4,20})['"]/i)?.[1];
  const key = block.match(/key\s*:\s*['"]([A-Za-z0-9]{16,64})['"]/)?.[1];
  const indexName = block.match(
    /(?:index|index_name|indexName)\s*:\s*['"]([A-Za-z0-9_-]{2,64})['"]/,
  )?.[1];

  return {
    appId: app ?? EVISION_DEFAULT_ALGOLIA.appId,
    apiKey: key ?? EVISION_DEFAULT_ALGOLIA.apiKey,
    indexName: indexName ?? EVISION_DEFAULT_ALGOLIA.indexName,
  };
}

function algoliaEndpoint(config: EvisionAlgoliaConfig): string {
  return `https://${config.appId}-dsn.algolia.net/1/indexes/${config.indexName}/query`;
}

/* -------------------------------------------------------------------------- */
/* URL building — the single rule that keeps listings alive                   */
/* -------------------------------------------------------------------------- */

/**
 * eVision product pages only exist under `/products/<slug>`:
 * `https://www.evisionstore.com/<slug>` answers **HTTP 404**, while
 * `https://www.evisionstore.com/products/<slug>` answers **HTTP 200**.
 *
 * Accepts a bare slug, a site-relative path or an absolute URL (Algolia `url`
 * is the broken root form) and always returns the canonical `/products/` form.
 */
export function buildEvisionProductUrl(
  baseUrl: string,
  slugOrUrl: string | null | undefined,
): string | null {
  const base = (baseUrl || "").replace(/\/+$/, "");
  const raw = (slugOrUrl ?? "").trim();
  if (!base || !raw || raw === "#") return null;

  let slugSource = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (/\/products\/[^/]+/i.test(parsed.pathname)) {
        parsed.hash = "";
        parsed.search = "";
        return parsed.toString();
      }
      slugSource = parsed.pathname;
    } catch {
      return null;
    }
  }

  const segments = slugSource.split(/[?#]/)[0]?.split("/").filter(Boolean) ?? [];
  const slug = segments[segments.length - 1];
  if (!slug || slug.toLowerCase() === "products") return null;

  return `${base}/products/${slug}`;
}

/* -------------------------------------------------------------------------- */
/* Algolia hit → RawScrapedItem                                               */
/* -------------------------------------------------------------------------- */

function statusValue(input: EvisionStockStatus | string | null | undefined): string | null {
  if (!input) return null;
  if (typeof input === "string") return input.trim().toLowerCase() || null;
  const value = input.value?.trim().toLowerCase();
  return value || null;
}

function isOutOfStock(hit: EvisionAlgoliaHit): boolean {
  const value = statusValue(hit.stock_status);
  if (value) {
    return /out[_\s-]?of[_\s-]?stock|agotado|sin[_\s-]?existencia|sold[_\s-]?out/.test(value);
  }

  const label = typeof hit.stock_status === "object" ? hit.stock_status?.label : null;
  return Boolean(label && /out of stock|agotado|sin existencia/i.test(label));
}

/** `"Tcl"` → `"TCL"`, `"samsung"` → `"Samsung"`, `"AOC"` → `"AOC"`. */
function normalizeBrandWord(word: string): string {
  if (!word) return word;
  if (word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
  if (/[a-z][A-Z]/.test(word)) return word; // iPhone, McCormick
  if (word.length <= 3 && /^[A-Za-z]+$/.test(word)) return word.toUpperCase(); // Tcl → TCL
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function normalizeEvisionBrand(value: string | null | undefined): string | null {
  const raw = (value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw.split(" ").map(normalizeBrandWord).join(" ").slice(0, 120);
}

/** Current price: `price_numeric`, then the sale price, then the list price. */
function pickPriceCents(hit: EvisionAlgoliaHit): {
  currentPriceCents: number | null;
  listPriceCents: number | null;
} {
  const priceNumericCents = parsePriceToCents(hit.price_numeric);
  const salePriceCents = parsePriceToCents(hit.sale_price);
  const listPriceCents = parsePriceToCents(hit.price);

  let currentPriceCents = priceNumericCents ?? listPriceCents ?? salePriceCents;
  if (
    hit.is_on_sale &&
    salePriceCents &&
    (!currentPriceCents || salePriceCents < currentPriceCents)
  ) {
    currentPriceCents = salePriceCents;
  }

  return { currentPriceCents, listPriceCents };
}

function specsFromHit(hit: EvisionAlgoliaHit): Record<string, unknown> | undefined {
  const specs = Array.isArray(hit.specs)
    ? hit.specs.filter((entry) => typeof entry === "string")
    : [];
  const facets = hit.spec_facets && typeof hit.spec_facets === "object" ? hit.spec_facets : {};
  if (specs.length === 0 && Object.keys(facets).length === 0) return undefined;

  const parsed: Record<string, unknown> = {};
  for (const entry of specs.slice(0, 40)) {
    const separator = entry.indexOf(":");
    if (separator === -1) setSpec(parsed, entry, true);
    else setSpec(parsed, entry.slice(0, separator), entry.slice(separator + 1));
  }
  for (const [key, value] of Object.entries(facets).slice(0, 40)) {
    if (typeof value === "string") setSpec(parsed, key, value);
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/** First value wins: `specs` (human readable) beats `spec_facets` (slugs). */
function setSpec(target: Record<string, unknown>, key: string, value: unknown): void {
  const cleanKey = key.trim();
  if (!cleanKey || cleanKey.length > 80 || cleanKey in target) return;
  if (typeof value === "string" && !value.trim()) return;
  target[cleanKey] = typeof value === "string" ? value.trim() : value;
}

/**
 * Maps one Algolia hit to the normalized item consumed by the ingestion
 * pipeline. Returns `null` for unpublished, price-less or non-electronics rows.
 */
export function mapEvisionHit(
  hit: EvisionAlgoliaHit | null | undefined,
  store: PanamaStoreConfig,
): RawScrapedItem | null {
  if (!hit) return null;

  const publishedStatus = statusValue(hit.status);
  if (publishedStatus && publishedStatus !== "published") return null;

  const title = (hit.name ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 3) return null;

  const url = buildEvisionProductUrl(store.baseUrl, hit.slug ?? hit.url);
  if (!url) return null;

  const { currentPriceCents, listPriceCents } = pickPriceCents(hit);
  if (!currentPriceCents) return null;

  const externalId = String(hit.objectID ?? hit.sku ?? hit.slug ?? "").trim();
  if (!externalId) return null;

  const categories = Array.isArray(hit.categories)
    ? hit.categories.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
      )
    : [];
  const productType = categories.length > 0 ? categories.join(" / ") : null;

  const sku = hit.sku?.trim() || hit.model_number?.trim() || null;
  const modelNumber = hit.model_number?.trim() || hit.sku?.trim() || null;
  const brand = normalizeEvisionBrand(hit.brand) ?? extractPanamaBrand(title);

  const item: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: externalId.slice(0, MAX_EXTERNAL_ID_LENGTH),
    title,
    brand,
    modelNumber,
    // eVision publishes the manufacturer code (`TAC12CSDIBWG`) as `sku`.
    trustSkuModel: true,
    sku,
    gtin: null,
    productType,
    priceCents: currentPriceCents,
    originalPriceCents:
      listPriceCents && listPriceCents > currentPriceCents ? listPriceCents : null,
    currency: "USD",
    inStock: !isOutOfStock(hit),
    url,
    imageUrl: hit.image && /^https?:\/\//i.test(hit.image) ? hit.image : null,
    rawSpecs: {
      platform: "botble-algolia",
      objectID: externalId,
      slug: hit.slug ?? null,
      storeCategory: categories[0] ?? null,
      categories,
      listPrice: hit.price ?? null,
      salePrice: hit.sale_price ?? null,
      isOnSale: Boolean(hit.is_on_sale),
      stockLabel: typeof hit.stock_status === "object" ? (hit.stock_status?.label ?? null) : null,
      specs: specsFromHit(hit) ?? null,
    },
  };

  if (!isRelevantElectronicsProduct(item)) return null;
  return item;
}

/** Paces Algolia requests: the key throttles bursts, 150 ms gaps never 429. */
function createPacer(intervalMs = ALGOLIA_MIN_INTERVAL_MS): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}

interface AlgoliaSession {
  config: EvisionAlgoliaConfig;
  /** Requests already spent (hard cap: `MAX_TOTAL_REQUESTS`). */
  requests: number;
  pace: () => Promise<void>;
}

function createAlgoliaSession(config: EvisionAlgoliaConfig): AlgoliaSession {
  return { config, requests: 0, pace: createPacer() };
}

/**
 * Single Algolia query: paced start, single HTTP attempt, exponential backoff
 * on 429/5xx. The Search-Only key answers `Too many requests` in bursts, so the
 * retry happens here instead of inside the generic HTTP helper.
 */
async function queryEvisionIndex(
  session: AlgoliaSession,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AlgoliaQueryResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < ALGOLIA_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error("Solicitud cancelada (Algolia)");
    if (session.requests >= MAX_TOTAL_REQUESTS) {
      throw new Error("Presupuesto de peticiones a Algolia agotado");
    }
    await session.pace();
    session.requests += 1;

    try {
      return await postJson<AlgoliaQueryResponse>(algoliaEndpoint(session.config), body, {
        timeoutMs: 20_000,
        retries: 0,
        headers: {
          "X-Algolia-Application-Id": session.config.appId,
          "X-Algolia-API-Key": session.config.apiKey,
        },
        signal,
      });
    } catch (error) {
      lastError = error;
      const status = error instanceof HttpError ? error.status : 0;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable) throw error;
      await sleep(Math.min(8_000, 700 * 2 ** attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchFacetShelves(
  session: AlgoliaSession,
  signal?: AbortSignal,
): Promise<{ shelves: FacetShelf[]; totalHits: number }> {
  const response = await queryEvisionIndex(
    session,
    {
      query: "",
      hitsPerPage: 0,
      facets: ["categories"],
      maxValuesPerFacet: 500,
      attributesToRetrieve: ["objectID"],
    },
    signal,
  );

  const counts = response.facets?.categories ?? {};
  const shelves = Object.entries(counts)
    .filter(([name]) => name.trim() !== "")
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { shelves, totalHits: Number(response.nbHits ?? 0) };
}

/**
 * The 12 verified root shelves. Children ("Estufas", "Side By Side", "Piso"…)
 * are subsets of a root, so walking them would only repeat the same hits.
 */
function selectRootShelves(shelves: FacetShelf[]): FacetShelf[] {
  const byName = new Map(shelves.map((shelf) => [shelf.name.toLowerCase(), shelf]));
  const roots: FacetShelf[] = [];
  const used = new Set<string>();

  for (const name of ROOT_CATEGORIES) {
    const shelf = byName.get(name.toLowerCase());
    if (!shelf || used.has(shelf.name)) continue;
    roots.push(shelf);
    used.add(shelf.name);
  }

  // A renamed root must not cost us a whole department: top up with the
  // highest-count facet that is still missing.
  for (const shelf of shelves) {
    if (roots.length >= ROOT_CATEGORIES.length) break;
    if (used.has(shelf.name)) continue;
    roots.push(shelf);
    used.add(shelf.name);
  }

  return roots;
}

interface AlgoliaPageResult {
  items: RawScrapedItem[];
  /** False when a page failed permanently (rate limit / network). */
  complete: boolean;
  pagesFetched: number;
}

/**
 * Pages one query. Algolia's Search-Only key returns 10 hits per request and
 * refuses to page past hit 1,000, so `maxPages` is capped at 100.
 * `facetFilter: null` runs the unfiltered catalog sweep.
 */
async function fetchAlgoliaPages(options: {
  session: AlgoliaSession;
  store: PanamaStoreConfig;
  maxPages: number;
  facetFilter: string | null;
  signal?: AbortSignal;
  onPage?: (page: number, fetched: number) => void;
}): Promise<AlgoliaPageResult> {
  const { session, store, maxPages, facetFilter, signal, onPage } = options;
  const items: RawScrapedItem[] = [];
  const totalPages = Math.max(1, Math.min(maxPages, MAX_PAGES_PER_CATEGORY));
  let complete = true;
  let pagesFetched = 0;

  for (let page = 0; page < totalPages; page += 1) {
    if (signal?.aborted) break;

    let response: AlgoliaQueryResponse;
    try {
      response = await queryEvisionIndex(
        session,
        {
          query: "",
          hitsPerPage: HITS_PER_PAGE,
          page,
          ...(facetFilter ? { facetFilters: [[`categories:${facetFilter}`]] } : {}),
        },
        signal,
      );
    } catch {
      complete = false;
      break;
    }

    const hits = response.hits ?? [];
    pagesFetched += 1;
    for (const hit of hits) {
      const item = mapEvisionHit(hit, store);
      if (item) items.push(item);
    }
    onPage?.(page, hits.length);
    if (hits.length < HITS_PER_PAGE) break;
  }

  return { items, complete, pagesFetched };
}

/** Adds new ids to the store-wide dedupe map without exceeding the goal. */
function mergeItems(
  target: Map<string, RawScrapedItem>,
  items: RawScrapedItem[],
  goal: number,
): number {
  let added = 0;
  for (const item of items) {
    if (target.size >= goal) break;
    if (target.has(item.externalId)) continue;
    target.set(item.externalId, item);
    added += 1;
  }
  return added;
}

/** Interleaves shelves so a single big category never monopolizes the budget. */
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

/**
 * Full-catalog mode (≈1,394 products):
 *   1. one unfiltered sweep of the 100 pages Algolia allows (1,000 hits), then
 *   2. the 12 root shelves (each ≤512 hits) to capture what the global ranking
 *      leaves out of the top 1,000.
 * Everything is deduped by `objectID`, so overlap costs requests only.
 */
async function scrapeAlgoliaFullCatalog(
  store: PanamaStoreConfig,
  session: AlgoliaSession,
  context: AdapterContext,
  totalHits: number,
  shelves: FacetShelf[],
): Promise<RawScrapedItem[]> {
  const goal = Math.min(context.maxPerStore, totalHits > 0 ? totalHits : context.maxPerStore);
  const collected = new Map<string, RawScrapedItem>();

  const sweep = await fetchAlgoliaPages({
    session,
    store,
    maxPages: MAX_PAGES_PER_CATEGORY,
    facetFilter: null,
    signal: context.signal,
  });
  mergeItems(collected, sweep.items, goal);
  context.log(
    `  evisionstore: barrido general ${sweep.pagesFetched} páginas → ${sweep.items.length} hits (${collected.size}/${goal})`,
  );
  if (!sweep.complete) {
    context.log("  evisionstore: ⚠️  barrido general cortado por límite de Algolia");
  }

  for (const shelf of selectRootShelves(shelves)) {
    if (collected.size >= goal || context.signal?.aborted) break;

    const batch = await fetchAlgoliaPages({
      session,
      store,
      maxPages: MAX_PAGES_PER_CATEGORY,
      facetFilter: shelf.name,
      signal: context.signal,
    });
    const added = mergeItems(collected, batch.items, goal);
    context.log(
      `  evisionstore: ${shelf.name} (${shelf.count}) → +${added} · ${collected.size}/${goal}`,
    );
    if (!batch.complete) {
      context.log(`  evisionstore: ⚠️  ${shelf.name} incompleta (límite de Algolia)`);
    }
  }

  return [...collected.values()].slice(0, context.maxPerStore);
}

/** Small-budget mode: a couple of pages from each root shelf. */
async function scrapeAlgoliaBudget(
  store: PanamaStoreConfig,
  session: AlgoliaSession,
  context: AdapterContext,
  shelves: FacetShelf[],
): Promise<RawScrapedItem[]> {
  const targets = selectRootShelves(shelves).slice(0, SMALL_BUDGET_CATEGORIES);
  if (targets.length === 0) return [];

  const pagesPerShelf = Math.max(
    SMALL_BUDGET_MIN_PAGES,
    Math.min(
      SMALL_BUDGET_MAX_PAGES,
      Math.ceil(context.maxPerStore / targets.length / HITS_PER_PAGE),
    ),
  );

  const pools: RawScrapedItem[][] = [];
  for (const shelf of targets) {
    if (context.signal?.aborted) break;
    const batch = await fetchAlgoliaPages({
      session,
      store,
      maxPages: pagesPerShelf,
      facetFilter: shelf.name,
      signal: context.signal,
    });
    pools.push(batch.items);
  }

  context.log(
    `  evisionstore: ${targets.length} categorías × ${pagesPerShelf} páginas (${targets
      .slice(0, 4)
      .map((shelf) => shelf.name)
      .join(", ")}…)`,
  );

  return interleave(pools, context.maxPerStore);
}

/* -------------------------------------------------------------------------- */
/* HTML fallback (Botble `/products?page=N` + Cheerio)                        */
/* -------------------------------------------------------------------------- */

/** Parses the `.product-list-card` grid of `/products` (list layout). */
export function parseEvisionHtml(
  html: string,
  store: PanamaStoreConfig,
  limit: number,
): RawScrapedItem[] {
  if (!html || html.length < 200) return [];
  const $ = load(html);
  const items: RawScrapedItem[] = [];

  $(".product-list-card").each((_, element) => {
    if (items.length >= limit) return false;
    const card = $(element);

    const titleNode = card.find(".plc-title a").first();
    const title = (titleNode.attr("title") ?? titleNode.text() ?? "").replace(/\s+/g, " ").trim();
    if (title.length < 3) return;

    const href = titleNode.attr("href") ?? card.find(".plc-image a").first().attr("href") ?? null;
    const url = buildEvisionProductUrl(store.baseUrl, href);
    if (!url) return;

    const priceCents = parsePriceToCents(
      card.find('[data-bb-value="product-price"]').first().text(),
    );
    if (!priceCents) return;

    const oldPriceCents = parsePriceToCents(card.find(".old-price").first().text());

    const imageNode = card.find(".plc-image img").first();
    const imageRaw = imageNode.attr("src") ?? imageNode.attr("data-src") ?? null;
    const imageUrl =
      imageRaw && /^https?:\/\//i.test(imageRaw)
        ? imageRaw
        : imageRaw
          ? absolute(store.baseUrl, imageRaw)
          : null;

    const categoryLabel =
      card.find(".plc-category a").first().text().replace(/\s+/g, " ").trim() || null;

    // `data-id` is the Botble product id; the slug is a stable fallback.
    const dataId = card.find('[data-bb-toggle="add-to-cart"]').first().attr("data-id")?.trim();
    const externalId = (dataId || url.split("/").filter(Boolean).pop() || url).slice(
      0,
      MAX_EXTERNAL_ID_LENGTH,
    );

    const item: RawScrapedItem = {
      storeSlug: store.slug,
      externalId,
      title,
      brand: extractPanamaBrand(title),
      modelNumber: null,
      trustSkuModel: false,
      sku: null,
      gtin: null,
      productType: categoryLabel,
      priceCents,
      originalPriceCents: oldPriceCents && oldPriceCents > priceCents ? oldPriceCents : null,
      currency: "USD",
      inStock: !/agotado|out of stock|sin existencias/i.test(card.text()),
      url,
      imageUrl,
      rawSpecs: {
        platform: "botble-html",
        objectID: dataId ?? null,
        storeCategory: categoryLabel,
        categories: categoryLabel ? [categoryLabel] : [],
      },
    };

    if (!isRelevantElectronicsProduct(item)) return;
    items.push(item);
  });

  return dedupeItems(items).slice(0, limit);
}

function absolute(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, `${baseUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* HTML fallback                                                              */
/* -------------------------------------------------------------------------- */

async function scrapeEvisionHtmlFallback(
  store: PanamaStoreConfig,
  context: AdapterContext,
): Promise<RawScrapedItem[]> {
  const base = store.baseUrl.replace(/\/+$/, "");
  const collected: RawScrapedItem[] = [];
  const seen = new Set<string>();
  let page = 1;

  while (collected.length < context.maxPerStore && page <= MAX_HTML_PAGES) {
    if (context.signal?.aborted) break;

    let html: string;
    try {
      html = await fetchText(`${base}/products?page=${page}`, {
        timeoutMs: 25_000,
        retries: 1,
        headers: BROWSER_HEADERS,
        signal: context.signal,
      });
    } catch {
      break;
    }

    const rawCards = (html.match(/class="product-list-card"/g) ?? []).length;
    const parsed = parseEvisionHtml(html, store, HTML_PAGE_SIZE);
    for (const item of parsed) {
      if (collected.length >= context.maxPerStore) break;
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      collected.push(item);
    }

    // The pager returns no cards at all once it is exhausted; pages that are
    // fully filtered out (non-electronics) still count as progress.
    if (rawCards === 0) break;
    if (page % 15 === 0) {
      context.log(`  evisionstore: HTML página ${page} · ${collected.length} productos`);
    }

    page += 1;
    await sleep(HTML_PAGE_PAUSE_MS);
  }

  return dedupeItems(collected).slice(0, context.maxPerStore);
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

export function createEvisionStoreAdapter(store: PanamaStoreConfig): StoreAdapter {
  let cachedConfig: EvisionAlgoliaConfig | null = null;

  async function resolveConfig(context: AdapterContext): Promise<EvisionAlgoliaConfig> {
    if (cachedConfig) return cachedConfig;
    try {
      const html = await fetchText(store.baseUrl, {
        timeoutMs: 20_000,
        retries: 1,
        headers: BROWSER_HEADERS,
        signal: context.signal,
      });
      cachedConfig = extractEvisionAlgoliaConfig(html);
    } catch {
      cachedConfig = { ...EVISION_DEFAULT_ALGOLIA };
    }
    return cachedConfig;
  }

  return {
    slug: store.slug,
    engine: "json-api",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const config = await resolveConfig(context);
      const session = createAlgoliaSession(config);

      // ---- Algolia (primary engine, zero Firecrawl credits) ---------------
      try {
        const { shelves, totalHits } = await fetchFacetShelves(session, context.signal);
        if (shelves.length > 0 && totalHits > 0) {
          context.log(
            `  evisionstore: Algolia ${config.appId}/${config.indexName} · ${totalHits} productos · ${shelves.length} categorías`,
          );
          const items =
            context.maxPerStore > FULL_CATALOG_THRESHOLD
              ? await scrapeAlgoliaFullCatalog(store, session, context, totalHits, shelves)
              : await scrapeAlgoliaBudget(store, session, context, shelves);
          const unique = dedupeItems(items).slice(0, context.maxPerStore);
          if (unique.length > 0) {
            context.log(
              `  evisionstore: ${unique.length} productos relevantes (Algolia, ${session.requests} peticiones)`,
            );
            return unique;
          }
          context.log("  evisionstore: Algolia no devolvió productos, se usa el HTML");
        }
      } catch (error) {
        context.log(
          `  evisionstore: Algolia falló (${error instanceof Error ? error.message : String(error)}), se usa el HTML`,
        );
      }

      // ---- Botble HTML fallback ------------------------------------------
      const fallback = await scrapeEvisionHtmlFallback(store, context);
      context.log(`  evisionstore: ${fallback.length} productos relevantes (HTML)`);
      return fallback;
    },
  };
}
