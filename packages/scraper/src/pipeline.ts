import { db, eq, scrapeRuns, stores } from "@regateo/db";
import { PANAMA_STORES, type PanamaStoreConfig } from "@regateo/shared";
import { createStoreAdapter } from "./adapters";
import { enrichStoreFromDatabase } from "./enrich";
import { getFirecrawlClient } from "./firecrawl-client";
import { ensureStoresSeeded, ingestScrapedItems } from "./ingest";

/**
 * Orchestrates a full scrape: seed stores → run each store adapter → ingest →
 * record `scrape_runs` rows. One failing store never aborts the whole pipeline.
 */

export interface ScrapeRunSummary {
  runId: string;
  storeSlug: string;
  engine: string;
  status: "completed" | "failed";
  itemsFound: number;
  itemsUpserted: number;
  errorMessage?: string;
}

export interface RunScrapePipelineOptions {
  stores?: string[];
  maxPerStore?: number;
  useFirecrawl?: boolean;
  /** Cross-store model search enrichment (default true). */
  enrich?: boolean;
  /** Silences progress logging (used by `--json` in CI). */
  quiet?: boolean;
}

const DEFAULT_MAX_PER_STORE = 5000;
const HARD_MAX_PER_STORE = 20_000;
const ENRICH_LIMIT = Number(process.env.SCRAPE_ENRICH_LIMIT ?? 80);
const STORE_TIMEOUT_MS = Number(process.env.SCRAPE_STORE_TIMEOUT_MS ?? 15 * 60 * 1000);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} excedió el tiempo límite de ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function resolveTargets(requested: string[] | undefined, log: (message: string) => void): PanamaStoreConfig[] {
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

/**
 * Runs the scraping pipeline and returns one summary per store.
 *
 * @example
 *   const summaries = await runScrapePipeline({ maxPerStore: 40 });
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

  log("🛒  RegateoApp · scrape de tiendas panameñas");
  log(`    max por tienda: ${maxPerStore} · firecrawl: ${useFirecrawl ? "sí" : "no"}`);

  await ensureStoresSeeded();

  const targets = resolveTargets(options.stores, log);
  const storeRows = await db.select({ id: stores.id, slug: stores.slug }).from(stores);
  const storeIds = new Map(storeRows.map((row) => [row.slug, row.id]));

  const firecrawl = getFirecrawlClient({ verbose: false });
  const firecrawlStatus = firecrawl.status();
  log(
    `    firecrawl: ${firecrawlStatus.mode}${
      firecrawlStatus.mode === "cli" ? " (CLI autenticado)" : ""
    }${firecrawlStatus.apiUrl ? ` · ${firecrawlStatus.apiUrl}` : ""}`
  );

  const summaries: ScrapeRunSummary[] = [];

  for (const [index, store] of targets.entries()) {
    const position = `[${index + 1}/${targets.length}]`;
    const adapter = createStoreAdapter(store);
    const storeId = storeIds.get(store.slug) ?? null;

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
    log(`\n${position} ${store.name} (${store.slug}) · ${adapter.engine}`);

    try {
      const items = await withTimeout(
        adapter.scrape({ store, maxPerStore, useFirecrawl, log }),
        STORE_TIMEOUT_MS,
        `${store.name} scrape`
      );

      let itemsUpserted = 0;
      let skipped = 0;
      if (items.length > 0) {
        const result = await ingestScrapedItems(store.slug, items, adapter.engine);
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

      summaries.push({
        runId,
        storeSlug: store.slug,
        engine: adapter.engine,
        status: "completed",
        itemsFound: items.length,
        itemsUpserted,
      });

      log(
        `    ✅ ${items.length} encontrados · ${itemsUpserted} guardados${
          skipped > 0 ? ` · ${skipped} omitidos` : ""
        }`
      );
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

      summaries.push({
        runId,
        storeSlug: store.slug,
        engine: adapter.engine,
        status: "failed",
        itemsFound: 0,
        itemsUpserted: 0,
        errorMessage: message,
      });

      log(`    ❌ ${store.name} falló: ${message}`);
    }
  }

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

  const totals = summaries.reduce(
    (accumulator, summary) => {
      accumulator.itemsFound += summary.itemsFound;
      accumulator.itemsUpserted += summary.itemsUpserted;
      if (summary.status === "completed") accumulator.completed += 1;
      else accumulator.failed += 1;
      return accumulator;
    },
    { itemsFound: 0, itemsUpserted: 0, completed: 0, failed: 0 }
  );

  log(
    `\n📦  Total: ${totals.itemsUpserted} productos guardados de ${totals.itemsFound} encontrados · ${totals.completed} tiendas OK · ${totals.failed} con error · ${(
      (Date.now() - startedAt) / 1000
    ).toFixed(1)}s`
  );

  return summaries;
}
