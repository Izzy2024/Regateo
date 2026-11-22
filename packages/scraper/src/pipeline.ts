import { and, db, eq, sql, scrapeRuns, storeListings, stores } from "@regateo/db";
import { PANAMA_STORES, type PanamaStoreConfig } from "@regateo/shared";
import { createStoreAdapter } from "./adapters";
import { evaluateAndDispatchPriceAlerts } from "./alerts";
import { enrichStoreFromDatabase } from "./enrich";
import { getFirecrawlClient } from "./firecrawl-client";
import { ensureStoresSeeded, ingestScrapedItems } from "./ingest";

/**
 * Orchestrates a full scrape: seed stores → run each store adapter (2-3 in
 * parallel) → ingest (serialized) → record `scrape_runs` → dispatch price
 * alerts. One failing store never aborts the whole pipeline.
 */

export interface ScrapeRunSummary {
  runId: string;
  storeSlug: string;
  engine: string;
  status: "completed" | "failed";
  itemsFound: number;
  itemsUpserted: number;
  errorMessage?: string;
  /** Set when the store returned <60% of its previous listings. */
  healthWarning?: string;
}

export interface RunScrapePipelineOptions {
  stores?: string[];
  maxPerStore?: number;
  useFirecrawl?: boolean;
  /** Cross-store model search enrichment (default true). */
  enrich?: boolean;
  /** Stores scraped in parallel (default 2, max 3). */
  concurrency?: number;
  /** Silences progress logging (used by `--json` in CI). */
  quiet?: boolean;
}

const DEFAULT_MAX_PER_STORE = 5000;
const HARD_MAX_PER_STORE = 20_000;
const ENRICH_LIMIT = Number(process.env.SCRAPE_ENRICH_LIMIT ?? 80);
const STORE_TIMEOUT_MS = Number(process.env.SCRAPE_STORE_TIMEOUT_MS ?? 15 * 60 * 1000);
const DEFAULT_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 2);
const HEALTH_MIN_RATIO = 0.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Serializes DB ingestion across parallel store workers: scraping is I/O bound
 * and parallel, but slug/key upserts must not race each other.
 */
let ingestChain: Promise<unknown> = Promise.resolve();
function withIngestLock<T>(task: () => Promise<T>): Promise<T> {
  const run = ingestChain.then(task, task);
  ingestChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function resolveTargets(
  requested: string[] | undefined,
  log: (message: string) => void
): PanamaStoreConfig[] {
  const enabled = PANAMA_STORES.filter((store) => store.enabled);
  if (!requested || requested.length === 0) return enabled;

  const normalized = requested.map((slug) => slug.trim().toLowerCase()).filter(Boolean);
  const known = new Set(PANAMA_STORES.map((store) => store.slug));
  for (const slug of normalized) {
    if (!known.has(slug)) log(`⚠️  Tienda desconocida ignorada: ${slug}`);
  }

  const targets = enabled.filter((store) => normalized.includes(store.slug));
  if (targets.length === 0) {
    throw new Error(
      `Ninguna de las tiendas solicitadas está habilitada (${normalized.join(", ")}). Disponibles: ${enabled
        .map((store) => store.slug)
        .join(", ")}`
    );
  }
  return targets;
}

interface StoreRunContext {
  store: PanamaStoreConfig;
  position: string;
  adapter: ReturnType<typeof createStoreAdapter>;
  storeId: string | null;
  log: (message: string) => void;
}

async function previousListingCount(storeId: string | null): Promise<number> {
  if (!storeId) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storeListings)
    .where(eq(storeListings.storeId, storeId));
  return Number(row?.count ?? 0);
}

async function runSingleStore(
  context: StoreRunContext,
  options: { maxPerStore: number; useFirecrawl: boolean }
): Promise<ScrapeRunSummary> {
  const { store, adapter, storeId, log } = context;

  const [run] = await db
    .insert(scrapeRuns)
    .values({
      storeId,
      storeSlug: store.slug,
      engine: adapter.engine,
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: scrapeRuns.id });

  const runId = run?.id ?? crypto.randomUUID();
  const before = await previousListingCount(storeId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);

  try {
    log(`${context.position} ${store.name} (${store.slug}) · ${adapter.engine}`);

    const items = await adapter.scrape({
      store,
      maxPerStore: options.maxPerStore,
      useFirecrawl: options.useFirecrawl,
      signal: controller.signal,
      log,
    });

    if (controller.signal.aborted) {
      throw new Error(
        `Timeout de ${Math.round(STORE_TIMEOUT_MS / 1000)}s: el adaptador fue cancelado`
      );
    }

    const healthWarning =
      before > 0 && items.length < before * HEALTH_MIN_RATIO
        ? `Salud: ${items.length} listings vs ${before} previos (<${Math.round(
            HEALTH_MIN_RATIO * 100
          )}%). Posible bloqueo o cambio de estructura.`
        : undefined;
    if (healthWarning) log(`    ⚠️  ${store.slug}: ${healthWarning}`);

    let itemsUpserted = 0;
    let skipped = 0;

    if (items.length > 0) {
      const result = await withIngestLock(() =>
        ingestScrapedItems(store.slug, items, adapter.engine, {
          signal: controller.signal,
        })
      );
      itemsUpserted = result.itemsUpserted;
      skipped = result.skipped;
    }

    await db
      .update(scrapeRuns)
      .set({
        status: "completed",
        itemsFound: items.length,
        itemsUpserted,
        finishedAt: new Date(),
      })
      .where(eq(scrapeRuns.id, runId));

    log(
      `    ✅ [${store.slug}] ${items.length} encontrados · ${itemsUpserted} guardados${
        skipped > 0 ? ` · ${skipped} omitidos` : ""
      }`
    );

    return {
      runId,
      storeSlug: store.slug,
      engine: adapter.engine,
      status: "completed",
      itemsFound: items.length,
      itemsUpserted,
      healthWarning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(scrapeRuns)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 2000),
        finishedAt: new Date(),
      })
      .where(eq(scrapeRuns.id, runId))
      .catch(() => undefined);

    log(`    ❌ [${store.slug}] ${store.name} falló: ${message}`);

    return {
      runId,
      storeSlug: store.slug,
      engine: adapter.engine,
      status: "failed",
      itemsFound: 0,
      itemsUpserted: 0,
      errorMessage: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the scraping pipeline and returns one summary per store.
 *
 * @example
 *   const summaries = await runScrapePipeline({ maxPerStore: 500 });
 */
export async function runScrapePipeline(
  options: RunScrapePipelineOptions = {}
): Promise<ScrapeRunSummary[]> {
  const startedAt = Date.now();
  const log = options.quiet ? () => undefined : (message: string) => console.log(message);
  const maxPerStore = clamp(
    Math.trunc(options.maxPerStore ?? DEFAULT_MAX_PER_STORE),
    1,
    HARD_MAX_PER_STORE
  );
  const useFirecrawl = options.useFirecrawl ?? true;
  const concurrency = clamp(
    Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY),
    1,
    3
  );

  log("🛒  RegateoApp · scrape de tiendas panameñas");
  log(
    `    max por tienda: ${maxPerStore} · firecrawl: ${useFirecrawl ? "sí" : "no"} · tiendas en paralelo: ${concurrency}`
  );

  await ensureStoresSeeded();

  const targets = resolveTargets(options.stores, log);
  const storeRows = await db.select({ id: stores.id, slug: stores.slug }).from(stores);
  const storeIds = new Map(storeRows.map((row) => [row.slug, row.id]));

  const firecrawlStatus = getFirecrawlClient({ verbose: false }).status();
  log(
    `    firecrawl: ${firecrawlStatus.mode}${
      firecrawlStatus.mode === "cli" ? " (CLI autenticado)" : ""
    }${firecrawlStatus.apiUrl ? ` · ${firecrawlStatus.apiUrl}` : ""}`
  );

  const summaries: ScrapeRunSummary[] = [];
  const queue = targets.map((store, index) => ({
    store,
    position: `[${index + 1}/${targets.length}]`,
  }));

  // Worker pool: 2–3 stores scrape in parallel; ingestion is serialized.
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) break;
      const summary = await runSingleStore(
        {
          store: next.store,
          position: next.position,
          adapter: createStoreAdapter(next.store),
          storeId: storeIds.get(next.store.slug) ?? null,
          log,
        },
        { maxPerStore, useFirecrawl }
      );
      summaries.push(summary);
    }
  });
  await Promise.all(workers);

  summaries.sort(
    (a, b) =>
      targets.findIndex((store) => store.slug === a.storeSlug) -
      targets.findIndex((store) => store.slug === b.storeSlug)
  );

  // ---- Phase 2: cross-store model enrichment ------------------------------
  if (options.enrich !== false && Number.isFinite(ENRICH_LIMIT) && ENRICH_LIMIT > 0) {
    for (const store of targets) {
      const adapter = createStoreAdapter(store);
      const storeId = storeIds.get(store.slug);
      if (!storeId || !adapter.searchByTerm) continue;

      log(`\n🔎 ${store.name} · búsqueda cruzada por modelo`);
      const outcome = await enrichStoreFromDatabase({
        storeSlug: store.slug,
        storeId,
        adapter,
        limit: ENRICH_LIMIT,
        log,
      });

      if (outcome) {
        summaries.push({
          runId: outcome.runId,
          storeSlug: outcome.storeSlug,
          engine: outcome.engine,
          status: outcome.status,
          itemsFound: outcome.itemsFound,
          itemsUpserted: outcome.itemsUpserted,
          errorMessage: outcome.errorMessage,
        });
      }
    }
  }

  // ---- Phase 3: real price alerts -----------------------------------------
  try {
    await evaluateAndDispatchPriceAlerts(log);
  } catch (error) {
    log(`  ⚠️  Motor de alertas falló: ${(error as Error).message}`);
  }

  const totals = summaries.reduce(
    (accumulator, summary) => {
      accumulator.itemsFound += summary.itemsFound;
      accumulator.itemsUpserted += summary.itemsUpserted;
      if (summary.status === "completed") accumulator.completed += 1;
      else accumulator.failed += 1;
      if (summary.healthWarning) accumulator.warnings += 1;
      return accumulator;
    },
    { itemsFound: 0, itemsUpserted: 0, completed: 0, failed: 0, warnings: 0 }
  );

  log(
    `\n📦  Total: ${totals.itemsUpserted} productos guardados de ${totals.itemsFound} encontrados · ${totals.completed} tiendas OK · ${totals.failed} con error · ${totals.warnings} avisos de salud · ${(
      (Date.now() - startedAt) / 1000
    ).toFixed(1)}s`
  );

  return summaries;
}
