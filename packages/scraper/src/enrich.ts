import { and, db, desc, eq, products, scrapeRuns, sql, storeListings } from "@regateo/db";
import { ingestScrapedItems } from "./ingest";
import { deriveIdentity } from "./matching";
import type { RawScrapedItem, StoreAdapter } from "./types";

/**
 * Cross-store enrichment.
 *
 * Panamanian stores stock the same models but their category listings are far
 * too deep to page through completely (Panafoto alone exposes 1,000+ products in
 * "cómputo"). Instead of brute-force crawling, we take every model code already
 * discovered in the other stores, search it in the target store's own catalog
 * search and only accept results whose derived match key is *identical* to the
 * existing product. That guarantees we never invent a comparison: brand, model
 * and (for TVs) screen size must all agree, and the URL/price come straight from
 * the store.
 */

export interface EnrichmentOutcome {
  runId: string;
  storeSlug: string;
  engine: "magento-search";
  status: "completed" | "failed";
  modelsSearched: number;
  itemsFound: number;
  itemsUpserted: number;
  errorMessage?: string;
}

export interface EnrichStoreOptions {
  storeSlug: string;
  storeId: string;
  adapter: StoreAdapter;
  limit?: number;
  concurrency?: number;
  log?: (message: string) => void;
}

interface CandidateRow {
  id: string;
  matchKey: string;
  modelNumber: string | null;
  canonicalName: string;
}

const DEFAULT_LIMIT = 80;
const DEFAULT_CONCURRENCY = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function findCandidates(storeId: string, limit: number): Promise<CandidateRow[]> {
  return db
    .select({
      id: products.id,
      matchKey: products.matchKey,
      modelNumber: products.modelNumber,
      canonicalName: products.canonicalName,
    })
    .from(products)
    .where(
      and(
        sql`${products.modelNumber} is not null`,
        sql`length(${products.modelNumber}) >= 4`,
        sql`not exists (
          select 1 from ${storeListings} listing
          where listing.product_id = ${products.id} and listing.store_id = ${storeId}
        )`
      )
    )
    .orderBy(desc(products.updatedAt))
    .limit(limit);
}

export async function enrichStoreFromDatabase(
  options: EnrichStoreOptions
): Promise<EnrichmentOutcome | null> {
  const { storeSlug, storeId, adapter } = options;
  if (!adapter.searchByTerm) return null;

  const log = options.log ?? (() => undefined);
  const limit = Math.max(1, Math.min(300, options.limit ?? DEFAULT_LIMIT));
  const search = adapter.searchByTerm.bind(adapter);

  const [run] = await db
    .insert(scrapeRuns)
    .values({
      storeId,
      storeSlug,
      engine: "magento-search",
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: scrapeRuns.id });

  const runId = run?.id ?? crypto.randomUUID();

  try {
    const candidates = await findCandidates(storeId, limit);
    if (candidates.length === 0) {
      await db
        .update(scrapeRuns)
        .set({ status: "completed", finishedAt: new Date() })
        .where(eq(scrapeRuns.id, runId));
      return {
        runId,
        storeSlug,
        engine: "magento-search",
        status: "completed",
        modelsSearched: 0,
        itemsFound: 0,
        itemsUpserted: 0,
      };
    }

    const found = new Map<string, RawScrapedItem>();

    for (const batch of chunk(candidates, DEFAULT_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map(async (candidate) => {
          if (!candidate.modelNumber) return [];
          const items = await search(candidate.modelNumber, { limit: 4 });
          return items.filter((item) => {
            const identity = deriveIdentity({
              title: item.title,
              vendor: item.brand ?? null,
              sku: item.sku ?? null,
              productType: item.productType ?? null,
              storeSlug,
            });
            return identity.matchKey === candidate.matchKey;
          });
        })
      );

      for (const items of results) {
        for (const item of items) found.set(item.externalId, item);
      }
    }

    const items = [...found.values()];
    let itemsUpserted = 0;
    if (items.length > 0) {
      const result = await ingestScrapedItems(storeSlug, items, "magento-search");
      itemsUpserted = result.itemsUpserted;
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
      `    🔎 ${storeSlug}: ${candidates.length} modelos consultados · ${items.length} coincidencias verificadas · ${itemsUpserted} comparaciones nuevas`
    );

    return {
      runId,
      storeSlug,
      engine: "magento-search",
      status: "completed",
      modelsSearched: candidates.length,
      itemsFound: items.length,
      itemsUpserted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(scrapeRuns)
      .set({ status: "failed", errorMessage: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(scrapeRuns.id, runId))
      .catch(() => undefined);

    log(`    ❌ ${storeSlug} enriquecimiento falló: ${message}`);
    return {
      runId,
      storeSlug,
      engine: "magento-search",
      status: "failed",
      modelsSearched: 0,
      itemsFound: 0,
      itemsUpserted: 0,
      errorMessage: message,
    };
  }
}
