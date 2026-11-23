import type { PanamaStoreConfig } from "@regateo/shared";
import { BROWSER_HEADERS, fetchJson, sleep } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * LG Shop Panamá (`https://www.lgshop.com.pa`) — VTEX storefront.
 *
 * The public VTEX Catalog Search API returns the whole official LG catalog as
 * JSON (≈267 products in ~6 requests, no Firecrawl credits):
 *   GET /api/catalog_system/pub/products/search?_from=0&_to=49
 *
 * Two VTEX quirks handled here:
 *   1. The endpoint answers **HTTP 206 Partial Content**, never plain 200.
 *   2. Ranges are inclusive and capped at 50 items, so pagination walks
 *      `0-49`, `50-99`, … until the API answers an empty array.
 */

const PAGE_SIZE = 50;
/** Safety cap (267 products ≈ 6 pages); never walk an endless pager. */
const MAX_PAGES = 60;
const PAGE_PAUSE_MS = 120;

interface VtexOffer {
  Price?: number | null;
  ListPrice?: number | null;
  IsAvailable?: boolean | null;
  AvailableQuantity?: number | null;
}

interface VtexSeller {
  sellerId?: string;
  sellerName?: string;
  commertialOffer?: VtexOffer | null;
}

interface VtexImage {
  imageUrl?: string | null;
  imageText?: string | null;
}

interface VtexItem {
  itemId?: string | null;
  name?: string | null;
  nameComplete?: string | null;
  ean?: string | null;
  referenceId?: Array<{ Key?: string; Value?: string }> | null;
  images?: VtexImage[] | null;
  sellers?: VtexSeller[] | null;
}

export interface VtexProduct {
  productId?: string | number | null;
  productName?: string | null;
  productTitle?: string | null;
  productReference?: string | null;
  brand?: string | null;
  link?: string | null;
  categories?: string[] | null;
  items?: VtexItem[] | null;
}

function collapse(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** VTEX categories are `/Dept/Category/Subcategory/`: flatten to readable words. */
function flattenCategories(categories: string[] | null | undefined): string | null {
  if (!Array.isArray(categories)) return null;
  const words = new Set<string>();
  for (const path of categories) {
    for (const segment of path.split("/")) {
      const clean = collapse(segment);
      if (clean) words.add(clean);
    }
  }
  return words.size > 0 ? [...words].join(" ") : null;
}

/** Picks the item/offer to price: available stock first, then any priced one. */
export function pickVtexOffer(product: VtexProduct): { item: VtexItem; offer: VtexOffer } | null {
  const candidates: Array<{ item: VtexItem; offer: VtexOffer }> = [];
  for (const item of product.items ?? []) {
    for (const seller of item.sellers ?? []) {
      const offer = seller.commertialOffer ?? null;
      if (!offer) continue;
      if ((parsePriceToCents(offer.Price) ?? 0) <= 0) continue;
      candidates.push({ item, offer });
    }
  }
  if (candidates.length === 0) return null;

  const inStock = candidates.filter(
    (candidate) =>
      candidate.offer.IsAvailable === true && (candidate.offer.AvailableQuantity ?? 0) > 0,
  );
  return inStock[0] ?? candidates[0] ?? null;
}

export interface VtexAdapterOptions {
  defaultBrand?: string;
  /** When a store omits the model code from `productName` (e.g. Sony BRAVIA), append it so search & users see the exact model. */
  appendModelToTitle?: boolean;
}

/** Extracts a clean manufacturer model number from VTEX `productReference`. */
function normalizeVtexModelNumber(reference: string | null): string | null {
  if (!reference) return null;
  // Drop LG dotted regional suffix (`VM122C31.SSP3` → `VM122C31`) and Sony slash color/region suffix (`MDR-3R/SIC` → `MDR-3R`).
  const base = reference.split(/[./]/)[0]?.trim() ?? reference.trim();
  if (!base || base.length < 3 || /\s/.test(base)) return null;
  return base;
}

/** Maps one VTEX product into the normalized item consumed by ingestion. */
export function mapVtexProduct(
  product: VtexProduct | null | undefined,
  store: PanamaStoreConfig,
  options: VtexAdapterOptions = {},
): RawScrapedItem | null {
  if (!product) return null;

  const rawTitle = collapse(product.productName ?? product.productTitle ?? null);
  if (rawTitle.length < 3) return null;

  const link = (product.link ?? "").trim();
  if (!/^https?:\/\//i.test(link)) return null;

  const picked = pickVtexOffer(product);
  if (!picked) return null;

  const priceCents = parsePriceToCents(picked.offer.Price);
  if (!priceCents) return null;

  const listPriceCents = parsePriceToCents(picked.offer.ListPrice);
  const externalId = String(product.productId ?? picked.item.itemId ?? "").trim();
  if (!externalId) return null;

  const reference = collapse(product.productReference) || null;
  const modelNumber = normalizeVtexModelNumber(reference);
  const gtin = (picked.item.ean ?? "").replace(/\D/g, "") || null;
  const brand = collapse(product.brand) || options.defaultBrand || "LG";

  let title = rawTitle;
  if (
    options.appendModelToTitle &&
    modelNumber &&
    !rawTitle.toUpperCase().includes(modelNumber.toUpperCase())
  ) {
    title = `${rawTitle} (${modelNumber})`;
  }

  const item: RawScrapedItem = {
    storeSlug: store.slug,
    externalId,
    title,
    brand,
    modelNumber,
    trustSkuModel: Boolean(modelNumber),
    sku: reference,
    gtin,
    productType: flattenCategories(product.categories),
    priceCents,
    originalPriceCents: listPriceCents && listPriceCents > priceCents ? listPriceCents : null,
    currency: "USD",
    inStock: Boolean(
      picked.offer.IsAvailable === true && (picked.offer.AvailableQuantity ?? 0) > 0,
    ),
    url: link,
    imageUrl: picked.item.images?.[0]?.imageUrl?.trim() || null,
    rawSpecs: {
      platform: "vtex",
      productId: externalId,
      itemId: picked.item.itemId ?? null,
      productReference: reference,
      categories: product.categories ?? null,
      listPrice: picked.offer.ListPrice ?? null,
      availableQuantity: picked.offer.AvailableQuantity ?? null,
      sellers: (picked.item.sellers ?? []).map(
        (seller) => seller.sellerName ?? seller.sellerId ?? null,
      ),
    },
  };

  if (!isRelevantElectronicsProduct(item)) return null;
  return item;
}

export function createVtexStoreAdapter(
  store: PanamaStoreConfig,
  options: VtexAdapterOptions = {},
): StoreAdapter {
  return {
    slug: store.slug,
    engine: "json-api",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const base = store.baseUrl.replace(/\/+$/, "");
      const collected: RawScrapedItem[] = [];
      const maxPages = Math.min(
        MAX_PAGES,
        Math.max(1, Math.ceil(context.maxPerStore / PAGE_SIZE) + 2),
      );

      for (let page = 0; page < maxPages; page += 1) {
        if (context.signal?.aborted) break;
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const url = `${base}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}`;

        let batch: VtexProduct[];
        try {
          batch = await fetchJson<VtexProduct[]>(url, {
            timeoutMs: 25_000,
            retries: 1,
            headers: { ...BROWSER_HEADERS, Accept: "application/json" },
            signal: context.signal,
          });
        } catch (error) {
          context.log(
            `  ${store.slug}: fin de la paginación en _from=${from} (${error instanceof Error ? error.message : String(error)})`,
          );
          break;
        }

        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const product of batch) {
          const item = mapVtexProduct(product, store, options);
          if (item) collected.push(item);
        }

        if (page === 0 || (page + 1) % 3 === 0) {
          context.log(
            `  ${store.slug}: ${from + batch.length} productos VTEX · ${collected.length} relevantes`,
          );
        }
        if (batch.length < PAGE_SIZE) break;
        if (collected.length >= context.maxPerStore) break;
        await sleep(PAGE_PAUSE_MS);
      }

      const unique = dedupeItems(collected).slice(0, context.maxPerStore);
      context.log(`  ${store.slug}: ${unique.length} productos relevantes (VTEX)`);
      return unique;
    },
  };
}

export function createLgShopAdapter(store: PanamaStoreConfig): StoreAdapter {
  return createVtexStoreAdapter(store, { defaultBrand: "LG" });
}
