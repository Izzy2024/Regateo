import type { PanamaStoreConfig, ProductCategory } from "@regateo/shared";

/**
 * Engines the scraper can use for a given store. The value is persisted in
 * `scrape_runs.engine` (varchar 32) so keep every identifier short.
 */
export type ScrapeEngine =
  | "shopify-json"
  | "magento-graphql"
  | "magento-search"
  | "magento-html"
  | "firecrawl"
  | "http-cheerio"
  | "json-api";

/** Normalized item produced by every store adapter before ingestion. */
export interface RawScrapedItem {
  storeSlug: string;
  externalId: string;
  title: string;
  brand?: string | null;
  modelNumber?: string | null;
  /** Set false when the store SKU is not a manufacturer model code. */
  trustSkuModel?: boolean;
  sku?: string | null;
  /** GTIN/EAN/UPC supplied by the store (Shopify `variant.barcode`). */
  gtin?: string | null;
  category?: ProductCategory;
  productType?: string | null;
  priceCents: number;
  originalPriceCents?: number | null;
  currency: "USD";
  inStock: boolean;
  url: string;
  imageUrl?: string | null;
  rawSpecs?: Record<string, unknown>;
}

export interface AdapterContext {
  store: PanamaStoreConfig;
  maxPerStore: number;
  /** When false, adapters must avoid any Firecrawl call and use direct HTTP only. */
  useFirecrawl: boolean;
  /** Aborts the adapter when the store-level timeout fires. */
  signal?: AbortSignal;
  log: (message: string) => void;
}

export interface StoreAdapter {
  slug: string;
  /** Human readable engine label reported in `scrape_runs.engine`. */
  engine: ScrapeEngine;
  scrape(context: AdapterContext): Promise<RawScrapedItem[]>;
  /**
   * Optional catalog search used by the cross-store enrichment phase: given a
   * manufacturer model code, return the store products matching it.
   */
  searchByTerm?(term: string, options?: { limit?: number }): Promise<RawScrapedItem[]>;
}

export interface FirecrawlScrapeResult {
  url: string;
  source: "sdk" | "cli" | "http";
  html?: string;
  markdown?: string;
  links?: string[];
}

export interface IngestResult {
  itemsFound: number;
  itemsUpserted: number;
  productIds: string[];
  skipped: number;
}
