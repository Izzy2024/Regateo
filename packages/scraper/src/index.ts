/**
 * `@regateo/scraper` public API.
 *
 * Contract (see AGENT_CONTRACTS.md, Contrato 1):
 *   - ScrapeRunSummary
 *   - ensureStoresSeeded()
 *   - runScrapePipeline(options?)
 */
export type { ScrapeRunSummary, RunScrapePipelineOptions } from "./pipeline";
export { runScrapePipeline } from "./pipeline";

export { ensureStoresSeeded, ingestScrapedItems } from "./ingest";

export { refreshProductAggregates } from "./refresh-stats";
export {
  candidateCompatibility,
  candidateSeriesTokens,
  CANDIDATE_CATEGORIES,
  type CandidateView,
  type CandidateDecision,
} from "./candidates";

export {
  evaluateAndDispatchPriceAlerts,
  shouldTriggerAlert,
  type AlertDispatchResult,
  type AlertTriggerInput,
} from "./alerts";

export {
  buildChannelDealsMessage,
  formatChannelDealsText,
  sendWeeklyFavoritesDigest,
  type ChannelDeal,
  type ChannelDealsMessage,
  type ChannelDealsOptions,
  type WeeklyDigestOptions,
  type WeeklyDigestResult,
} from "./digest";

export type { RawScrapedItem, StoreAdapter, ScrapeEngine, IngestResult } from "./types";

export { createStoreAdapter } from "./adapters";
export { createShopifyAdapter } from "./adapters/shopify";
export { createPanafotoAdapter, parsePanafotoHtml } from "./adapters/panafoto";
export { createFirecrawlStoreAdapter, parseGenericStoreHtml } from "./adapters/firecrawl-store";

export { deriveIdentity, isRelevantElectronicsProduct, parsePriceToCents } from "./matching";

export {
  FirecrawlClient,
  getFirecrawlClient,
  resetFirecrawlClient,
  type FirecrawlStatus,
} from "./firecrawl-client";

export {
  DEFAULT_SCRAPE_INTERVAL_DAYS,
  getScrapeIntervalDays,
  nextScrapeDate,
} from "./scheduler-config";
