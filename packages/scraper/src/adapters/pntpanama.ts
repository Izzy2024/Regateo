import type { PanamaStoreConfig } from "@regateo/shared";
import { BROWSER_HEADERS, fetchJson, mapWithConcurrency, sleep } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * PlayNTrade Panamá (`https://pntpanama.com`) — Nuxt storefront with a public
 * REST catalog (≈665 gaming products over 28 pages, zero Firecrawl credits):
 *   GET /api/v6.2.7/products?page=N   → { pagination: { page, pages }, products: [...] }
 *
 * The tricky part is pricing: a single product exposes several `prices[]`
 * entries, and the cheapest one is frequently a **reservation deposit**
 * ("Reservar", `type: "reserve"`, $10) rather than the real price of the
 * console/game. The selection below always prefers a full-sale price over
 * deposits and used copies.
 */

const API_PATH = "/api/v6.2.7/products";
const CONCURRENCY = 3;
const PAGE_PAUSE_MS = 120;
const MAX_PAGES = 60;

/** Full-sale price types, strongest first. */
const FULL_SALE_TYPES = ["new", "normal", "standard", "physical", "digital", "presale"] as const;

/** Deposit / second-hand types only used when nothing else exists. */
const DEPOSIT_OR_USED = /reserve|deposit|abono|apartado|used|preowned|pre-owned|trade/i;

export interface PlayntradePrice {
  name?: string | null;
  type?: string | null;
  originalPrice?: number | null;
  discountPrice?: number | null;
  discount?: number | null;
  discountInsider?: number | null;
  inventory?: number | null;
  reserve?: number | null;
  status?: boolean | null;
  enable?: boolean | null;
}

export interface PlayntradeProduct {
  _id?: string | null;
  sku?: string | null;
  name?: string | null;
  slug?: string | null;
  desc?: string | null;
  type?: string | null;
  enable?: boolean | null;
  category?: string | null;
  platform?: string | null;
  coverpage?: string | null;
  release?: string | null;
  prices?: PlayntradePrice[] | null;
  promotions?: unknown;
}

interface PlayntradePage {
  msg?: string;
  total?: number;
  pagination?: { page?: number; pages?: number } | null;
  products?: PlayntradeProduct[] | null;
}

/**
 * Gaming products are the whole point of this store, but the generic
 * electronics filter drops legacy titles such as "FAR CRY 5 GAME - PS4"
 * (no "playstation" keyword, platform reported as "MERCANCÍA").
 */
const GAMING_CUES =
  /(ps[345]\b|ps ?vita|playstation|xbox|nintendo|switch|wii\b|amiibo|game|juego|consola|console|control|mando|dualsense|dualshock|joy-?con|pro controller|gamer|gaming|headset|aud[ií]fonos?|auricular|skullcandy|figura|coleccionable)/i;

/** True for anything PlayNTrade should contribute to a gaming/electronics catalog. */
export function isRelevantPlayntradeItem(item: RawScrapedItem): boolean {
  if (isRelevantElectronicsProduct(item)) return true;
  if (!Number.isFinite(item.priceCents) || item.priceCents < 500 || item.priceCents > 3_000_000) {
    return false;
  }
  return GAMING_CUES.test(`${item.title} ${item.productType ?? ""}`);
}

function typeRank(type: string | null | undefined): number {
  const normalized = (type ?? "").trim().toLowerCase();
  const index = FULL_SALE_TYPES.indexOf(normalized as (typeof FULL_SALE_TYPES)[number]);
  if (index !== -1) return index;
  // A used copy still has a real selling price; a reservation deposit does not.
  if (/used|preowned|pre-owned|trade/i.test(normalized)) return FULL_SALE_TYPES.length;
  if (/reserve|deposit|abono|apartado/i.test(normalized)) return FULL_SALE_TYPES.length + 1;
  return FULL_SALE_TYPES.length + 2;
}

/**
 * Picks the real selling price of a PlayNTrade product.
 *
 * `reserve` / `used` entries are only considered when there is no full-sale
 * price at all, so a $10 deposit never becomes the price of a $70 game.
 */
export function pickPlayntradePrice(prices: PlayntradePrice[] | null | undefined): {
  priceCents: number | null;
  originalPriceCents: number | null;
  priceType: string | null;
  inventory: number | null;
} {
  const candidates = (prices ?? []).filter((price) => {
    if (!price) return false;
    if (price.status === false || price.enable === false) return false;
    return (
      (parsePriceToCents(price.originalPrice) ?? 0) > 0 ||
      (parsePriceToCents(price.discountPrice) ?? 0) > 0
    );
  });

  if (candidates.length === 0) {
    return { priceCents: null, originalPriceCents: null, priceType: null, inventory: null };
  }

  const fullSale = candidates.filter((price) => !DEPOSIT_OR_USED.test(price.type ?? ""));
  const pool = fullSale.length > 0 ? fullSale : candidates;
  const chosen = pool
    .slice()
    .sort((a, b) => typeRank(a.type) - typeRank(b.type))[0] as PlayntradePrice;

  const originalCents = parsePriceToCents(chosen.originalPrice);
  const discountCents = parsePriceToCents(chosen.discountPrice);

  let priceCents: number | null;
  let originalPriceCents: number | null;
  if (discountCents && originalCents && discountCents < originalCents) {
    priceCents = discountCents;
    originalPriceCents = originalCents;
  } else {
    priceCents = originalCents ?? discountCents;
    originalPriceCents = null;
  }

  return {
    priceCents,
    originalPriceCents,
    priceType: chosen.type ?? null,
    inventory: typeof chosen.inventory === "number" ? chosen.inventory : null,
  };
}

/**
 * Canonical Nuxt route: `/products/:sku?/:slug?`.
 * Verified: `…/products/<sku>/<slug>`, `…/products/<sku>` and
 * `…/products/<slug>` all answer HTTP 200.
 */
export function buildPlayntradeUrl(
  baseUrl: string,
  product: { sku?: string | null; slug?: string | null },
): string | null {
  const base = (baseUrl || "").replace(/\/+$/, "");
  const sku = (product.sku ?? "").trim();
  const slug = (product.slug ?? "").trim();
  if (!base || (!sku && !slug)) return null;

  if (sku && slug) return `${base}/products/${sku}/${slug}`;
  return `${base}/products/${sku || slug}`;
}

/** Maps one REST product into the normalized item consumed by ingestion. */
export function mapPlayntradeProduct(
  product: PlayntradeProduct | null | undefined,
  store: PanamaStoreConfig,
): RawScrapedItem | null {
  if (!product) return null;
  if (product.enable === false) return null;

  const title = (product.name ?? "").replace(/\s+/g, " ").trim();
  if (title.length < 3) return null;

  const url = buildPlayntradeUrl(store.baseUrl, product);
  if (!url) return null;

  const { priceCents, originalPriceCents, priceType, inventory } = pickPlayntradePrice(
    product.prices,
  );
  if (!priceCents) return null;

  const externalId = String(product.sku ?? product._id ?? "").trim();
  if (!externalId) return null;

  const productType =
    [product.category, product.platform, "gaming"]
      .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ") || null;

  const item: RawScrapedItem = {
    storeSlug: store.slug,
    externalId: externalId.slice(0, 160),
    title,
    brand: null,
    modelNumber: null,
    // `pric_78319m` is an internal PlayNTrade code, never a manufacturer model.
    trustSkuModel: false,
    sku: (product.sku ?? "").trim() || null,
    gtin: null,
    productType,
    priceCents,
    originalPriceCents,
    currency: "USD",
    inStock: inventory === null ? true : inventory > 0,
    url,
    imageUrl: (product.coverpage ?? "").trim() || null,
    rawSpecs: {
      platform: "nuxt-rest",
      productId: product._id ?? null,
      sku: product.sku ?? null,
      slug: product.slug ?? null,
      itemType: product.type ?? null,
      storeCategory: product.category ?? null,
      gamePlatform: product.platform ?? null,
      priceType,
      releaseDate: product.release ?? null,
      inventory,
      prices: (product.prices ?? []).map((price) => ({
        type: price.type ?? null,
        originalPrice: price.originalPrice ?? null,
        discountPrice: price.discountPrice ?? null,
        status: price.status ?? null,
      })),
    },
  };

  if (!isRelevantPlayntradeItem(item)) return null;
  return item;
}

async function fetchPlayntradePage(
  base: string,
  page: number,
  signal?: AbortSignal,
): Promise<PlayntradePage | null> {
  return fetchJson<PlayntradePage>(`${base}${API_PATH}?page=${page}`, {
    timeoutMs: 25_000,
    retries: 1,
    headers: { ...BROWSER_HEADERS, Accept: "application/json" },
    signal,
  });
}

export function createPlayntradeAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "json-api",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const base = store.baseUrl.replace(/\/+$/, "");

      const first = await fetchPlayntradePage(base, 1, context.signal);
      if (!first || !Array.isArray(first.products)) {
        context.log("  pntpanama: la API no devolvió productos");
        return [];
      }

      const totalHits = Number(first.total ?? 0);
      const totalPages = Math.max(1, Math.min(MAX_PAGES, Number(first.pagination?.pages ?? 1)));
      context.log(`  pntpanama: ${totalHits} productos · ${totalPages} páginas`);

      const collected: RawScrapedItem[] = [];
      const push = (items: RawScrapedItem[]) => {
        for (const item of items) {
          if (collected.length >= context.maxPerStore) break;
          collected.push(item);
        }
      };

      const mapPage = (products: PlayntradeProduct[] | null | undefined) =>
        (products ?? [])
          .map((product) => mapPlayntradeProduct(product, store))
          .filter((item): item is RawScrapedItem => item !== null);

      push(mapPage(first.products));

      const pages = Math.min(
        Math.max(0, totalPages - 1),
        Math.max(1, Math.ceil(context.maxPerStore / 24) + 1),
      );
      const queue = Array.from({ length: pages }, (_, index) => index + 2);

      const results = await mapWithConcurrency(queue, CONCURRENCY, async (page) => {
        if (context.signal?.aborted) return [];
        await sleep(PAGE_PAUSE_MS);
        try {
          const payload = await fetchPlayntradePage(base, page, context.signal);
          return mapPage(payload?.products);
        } catch (error) {
          context.log(
            `  pntpanama: página ${page} falló (${error instanceof Error ? error.message : String(error)})`,
          );
          return [];
        }
      });

      for (const batch of results) push(batch);

      const unique = dedupeItems(collected).slice(0, context.maxPerStore);
      context.log(`  pntpanama: ${unique.length} productos relevantes (REST)`);
      return unique;
    },
  };
}
