import {
  and,
  db,
  desc,
  eq,
  inArray,
  priceHistory,
  products,
  stores,
  storeListings,
  sql,
} from "@regateo/db";
import { PANAMA_STORES, slugify } from "@regateo/shared";
import { deriveIdentity, type ParsedIdentity } from "./matching";
import type { ScrapeEngine, RawScrapedItem, IngestResult } from "./types";

/**
 * Persistence layer: turns adapter output into `products`, `store_listings`,
 * `price_history` and `scrape_runs` rows.
 *
 * Full-catalog runs push 10k+ items through here, so everything is written with
 * batched multi-row upserts (≈120 rows per statement) instead of one query per
 * product. A batch that hits an unexpected constraint falls back to per-row
 * writes so a single bad item never loses the rest of the store.
 */

/** Minimum gap between two identical price snapshots for the same listing. */
const HISTORY_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

const PRODUCT_BATCH_SIZE = 120;
const LISTING_BATCH_SIZE = 120;
const HISTORY_READ_BATCH = 400;
const HISTORY_WRITE_BATCH = 400;
const PROGRESS_EVERY = 500;

/**
 * Hard guardrail: a listing is never linked to an existing product of another
 * store when the price ratio is above 2.2x. Such cases are almost always a
 * matcher false positive (different model sold at a very different price), so
 * the listing gets its own deterministic `::store-externalId` product instead.
 */
const MAX_CROSS_STORE_PRICE_RATIO = 2.2;

function priceRatio(a: number, b: number): number {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return min > 0 ? max / min : Number.POSITIVE_INFINITY;
}

function splitMatchKey(matchKey: string, storeSlug: string, externalId: string): string {
  return `${matchKey}::${slugify(storeSlug)}-${slugify(externalId)}`.slice(0, 180);
}

function shortHash(value: string): string {
  // FNV-1a + sdbm: two independent 32-bit accumulators avoid the frequent
  // collisions of a single weak hash (e.g. two near-identical SKUs).
  let fnv = 0x811c9dc5;
  let sdbm = 0x1000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    sdbm = (Math.imul(sdbm, 0x1000193) + code) >>> 0;
  }
  return `${fnv.toString(36).padStart(7, "0")}${sdbm.toString(36).padStart(7, "0")}`.slice(-12);
}

/** Seeds/updates the Panamanian stores required by the product. */
export async function ensureStoresSeeded(): Promise<void> {
  const now = new Date();
  for (const store of PANAMA_STORES) {
    await db
      .insert(stores)
      .values({
        slug: store.slug,
        name: store.name,
        baseUrl: store.baseUrl,
        platform: store.platform,
        color: store.color,
        accentBg: store.accentBg,
        country: store.country,
        currency: store.currency,
        enabled: store.enabled,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: stores.slug,
        set: {
          name: store.name,
          baseUrl: store.baseUrl,
          platform: store.platform,
          color: store.color,
          accentBg: store.accentBg,
          country: store.country,
          currency: store.currency,
          enabled: store.enabled,
          updatedAt: now,
        },
      });
  }
}

interface PreparedItem {
  item: RawScrapedItem;
  identity: ParsedIdentity;
  slug: string;
}

/**
 * Multiple variants of the same model (colors, capacities sold as separate
 * SKUs) collapse into a single listing per store — a price comparison site only
 * needs the best available offer of a product per store.
 */
function groupByMatchKey(items: RawScrapedItem[]): Map<string, PreparedItem> {
  const groups = new Map<string, PreparedItem>();
  const seenExternalIds = new Set<string>();

  for (const item of items) {
    if (!Number.isFinite(item.priceCents) || item.priceCents <= 0) continue;
    if (!item.url.startsWith("http")) continue;
    // `store_listings` is unique per (store, external_id): keep one.
    if (seenExternalIds.has(item.externalId)) continue;
    seenExternalIds.add(item.externalId);

    const identity = deriveIdentity({
      title: item.title,
      vendor: item.brand ?? null,
      sku: item.sku ?? null,
      productType: item.productType ?? null,
      storeSlug: item.storeSlug,
      modelNumber: item.modelNumber ?? null,
      trustSku: item.trustSkuModel !== false,
    });

    const current = groups.get(identity.matchKey);
    if (!current) {
      groups.set(identity.matchKey, { item, identity, slug: "" });
      continue;
    }

    const currentScore = (current.item.inStock ? 0 : 1_000_000) + current.item.priceCents;
    const nextScore = (item.inStock ? 0 : 1_000_000) + item.priceCents;
    if (nextScore < currentScore) {
      groups.set(identity.matchKey, { item, identity, slug: "" });
    }
  }

  return groups;
}

interface SlugRegistry {
  owners: Map<string, string>;
}

async function loadSlugRegistry(): Promise<SlugRegistry> {
  const rows = await db.select({ slug: products.slug, matchKey: products.matchKey }).from(products);
  const owners = new Map<string, string>();
  for (const row of rows) owners.set(row.slug, row.matchKey);
  return { owners };
}

function resolveSlug(registry: SlugRegistry, identity: ParsedIdentity): string {
  const base =
    slugify(identity.canonicalName) ||
    slugify(`${identity.brand ?? "producto"} ${identity.modelNumber ?? ""}`) ||
    "producto";
  let slug = base.slice(0, 140);
  const owner = registry.owners.get(slug);

  if (owner && owner !== identity.matchKey) {
    slug = `${slug.slice(0, 128)}-${shortHash(identity.matchKey)}`;
  }

  // Extremely unlikely double collision: keep appending deterministic suffixes.
  let attempt = 1;
  while (registry.owners.has(slug) && registry.owners.get(slug) !== identity.matchKey) {
    slug = `${base.slice(0, 132)}-${shortHash(`${identity.matchKey}:${attempt}`)}`;
    attempt += 1;
    if (attempt > 5) break;
  }

  registry.owners.set(slug, identity.matchKey);
  return slug;
}

function embeddingTextFor(identity: ParsedIdentity, item: RawScrapedItem): string {
  return [identity.brand, identity.canonicalName, identity.category, identity.modelNumber, item.title]
    .filter((value): value is string => Boolean(value))
    .join(" | ")
    .slice(0, 1200);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

interface ProcessedListing {
  listingId: string;
  priceCents: number;
  inStock: boolean;
  /** True when price or stock differs from what the DB had before this run. */
  changed: boolean;
}

/**
 * Upserts every scraped item of a store and records today's real price
 * snapshot. No synthetic/fabricated history is written: `price_history` only
 * grows with actual observations taken by this run.
 */
export async function ingestScrapedItems(
  storeSlug: string,
  items: RawScrapedItem[],
  engine: ScrapeEngine,
  options: { signal?: AbortSignal } = {}
): Promise<IngestResult> {
  const [storeRow] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.slug, storeSlug))
    .limit(1);

  if (!storeRow) {
    throw new Error(`La tienda "${storeSlug}" no existe en la tabla stores`);
  }

  const storeId = storeRow.id;

  // Health baseline for the stale-listing sweep (never nuke data on a bad run).
  const [previousCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storeListings)
    .where(eq(storeListings.storeId, storeId));
  const previousListings = Number(previousCountRow?.count ?? 0);

  const registry = await loadSlugRegistry();
  const groups = groupByMatchKey(items);
  const now = new Date();

  const prepared: PreparedItem[] = [];
  for (const group of groups.values()) {
    group.slug = resolveSlug(registry, group.identity);
    prepared.push(group);
  }

  const processed: ProcessedListing[] = [];
  const productIds: string[] = [];
  const changedProductIds = new Set<string>();
  let skipped = 0;

  const productValues = (entry: PreparedItem) => ({
    slug: entry.slug,
    matchKey: entry.identity.matchKey,
    canonicalName: entry.identity.canonicalName,
    brand: entry.identity.brand,
    modelNumber: entry.identity.modelNumber,
    category: entry.identity.category,
    imageUrl: entry.item.imageUrl ?? null,
    specs: { ...entry.identity.specs, lastEngine: engine, lastStoreSlug: storeSlug },
    embeddingText: embeddingTextFor(entry.identity, entry.item),
    updatedAt: now,
  });

  const listingValues = (entry: PreparedItem, productId: string) => ({
    productId,
    storeId,
    externalId: entry.item.externalId,
    titleAtStore: entry.item.title,
    priceCents: entry.item.priceCents,
    originalPriceCents: entry.item.originalPriceCents ?? null,
    currency: entry.item.currency,
    inStock: entry.item.inStock,
    url: entry.item.url,
    imageUrl: entry.item.imageUrl ?? null,
    lastCheckedAt: now,
    updatedAt: now,
  });

  const productBatches = chunk(prepared, PRODUCT_BATCH_SIZE);

  for (const [batchIndex, batch] of productBatches.entries()) {
    if (options.signal?.aborted) break;
    let productIdsByKey = new Map<string, string>();

    try {
      const inserted = await db
        .insert(products)
        .values(batch.map(productValues))
        .onConflictDoUpdate({
          target: products.matchKey,
          set: {
            // Never let the last store that ran overwrite better metadata.
            canonicalName: sql`CASE WHEN length(${products.canonicalName}) >= length(excluded.canonical_name) THEN ${products.canonicalName} ELSE excluded.canonical_name END`,
            brand: sql`COALESCE(${products.brand}, excluded.brand)`,
            modelNumber: sql`COALESCE(${products.modelNumber}, excluded.model_number)`,
            category: sql`CASE WHEN excluded.category <> 'accesorios' THEN excluded.category ELSE ${products.category} END`,
            imageUrl: sql`COALESCE(${products.imageUrl}, excluded.image_url)`,
            specs: sql`COALESCE(${products.specs}, '{}'::jsonb) || excluded.specs`,
            embeddingText: sql`excluded.embedding_text`,
            // `updated_at` is bumped only when a price or stock really changed.
          },
        })
        .returning({ id: products.id, matchKey: products.matchKey });

      productIdsByKey = new Map(inserted.map((row) => [row.matchKey, row.id]));
    } catch (error) {
      // A single unexpected constraint problem must not lose the whole batch.
      console.warn(
        `  ⚠️  ${storeSlug}: lote de productos ${batchIndex + 1} falló, reintentando fila por fila (${(error as Error).message.slice(0, 140)})`
      );
      for (const entry of batch) {
        try {
          const [row] = await db
            .insert(products)
            .values(productValues(entry))
            .onConflictDoUpdate({
              target: products.matchKey,
              set: {
                canonicalName: sql`CASE WHEN length(${products.canonicalName}) >= length(excluded.canonical_name) THEN ${products.canonicalName} ELSE excluded.canonical_name END`,
                brand: sql`COALESCE(${products.brand}, excluded.brand)`,
                modelNumber: sql`COALESCE(${products.modelNumber}, excluded.model_number)`,
                category: sql`CASE WHEN excluded.category <> 'accesorios' THEN excluded.category ELSE ${products.category} END`,
                imageUrl: sql`COALESCE(${products.imageUrl}, excluded.image_url)`,
                specs: sql`COALESCE(${products.specs}, '{}'::jsonb) || excluded.specs`,
                embeddingText: sql`excluded.embedding_text`,
              },
            })
            .returning({ id: products.id, matchKey: products.matchKey });
          if (row) productIdsByKey.set(row.matchKey, row.id);
        } catch {
          skipped += 1;
        }
      }
    }

    // ---- Cross-store price sanity guard + change detection ---------------
    const existingByProduct = new Map<string, Array<{ storeId: string; priceCents: number }>>();
    const existingInternal = new Map<string, { priceCents: number; inStock: boolean }>();
    const productIdsInBatch = [...new Set(productIdsByKey.values())];
    for (const ids of chunk(productIdsInBatch, HISTORY_READ_BATCH)) {
      if (ids.length === 0) continue;
      const rows = await db
        .select({
          productId: storeListings.productId,
          storeId: storeListings.storeId,
          externalId: storeListings.externalId,
          priceCents: storeListings.priceCents,
          inStock: storeListings.inStock,
        })
        .from(storeListings)
        .where(inArray(storeListings.productId, ids));
      for (const row of rows) {
        const list = existingByProduct.get(row.productId) ?? [];
        list.push({ storeId: row.storeId, priceCents: row.priceCents });
        existingByProduct.set(row.productId, list);
        if (row.storeId === storeId) {
          existingInternal.set(row.externalId, {
            priceCents: row.priceCents,
            inStock: row.inStock,
          });
        }
      }
    }

    const effectiveProductIds = new Map<string, string>();

    for (const entry of batch) {
      const baseProductId = productIdsByKey.get(entry.identity.matchKey);
      if (!baseProductId) continue;

      const existing = existingByProduct.get(baseProductId) ?? [];
      const conflicts = existing.some(
        (listing) =>
          listing.storeId !== storeId &&
          priceRatio(listing.priceCents, entry.item.priceCents) > MAX_CROSS_STORE_PRICE_RATIO
      );

      if (!conflicts) {
        effectiveProductIds.set(entry.item.externalId, baseProductId);
        continue;
      }

      const scopedKey = splitMatchKey(entry.identity.matchKey, storeSlug, entry.item.externalId);
      const splitIdentity: ParsedIdentity = { ...entry.identity, matchKey: scopedKey };
      const splitSlug = resolveSlug(registry, splitIdentity);
      const splitEntry: PreparedItem = { ...entry, identity: splitIdentity, slug: splitSlug };

      try {
        const [splitRow] = await db
          .insert(products)
          .values(productValues(splitEntry))
          .onConflictDoUpdate({
            target: products.matchKey,
            set: {
              canonicalName: sql`CASE WHEN length(${products.canonicalName}) >= length(excluded.canonical_name) THEN ${products.canonicalName} ELSE excluded.canonical_name END`,
              brand: sql`COALESCE(${products.brand}, excluded.brand)`,
              modelNumber: sql`COALESCE(${products.modelNumber}, excluded.model_number)`,
              category: sql`CASE WHEN excluded.category <> 'accesorios' THEN excluded.category ELSE ${products.category} END`,
              imageUrl: sql`COALESCE(${products.imageUrl}, excluded.image_url)`,
              specs: sql`COALESCE(${products.specs}, '{}'::jsonb) || excluded.specs`,
              embeddingText: sql`excluded.embedding_text`,
            },
          })
          .returning({ id: products.id });

        if (splitRow) {
          effectiveProductIds.set(entry.item.externalId, splitRow.id);
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        if (skipped <= 5) {
          console.warn(
            `  ⚠️  ${storeSlug} · no se pudo separar "${entry.item.title.slice(0, 50)}": ${(error as Error).message.slice(0, 160)}`
          );
        }
      }
    }

    const listingBatch = batch.filter((entry) => effectiveProductIds.has(entry.item.externalId));
    skipped += batch.length - listingBatch.length;
    if (listingBatch.length === 0) continue;

    const listingRows = listingBatch.map((entry) =>
      listingValues(entry, effectiveProductIds.get(entry.item.externalId)!)
    );

    try {
      const insertedListings = await db
        .insert(storeListings)
        .values(listingRows)
        .onConflictDoUpdate({
          target: [storeListings.storeId, storeListings.externalId],
          set: {
            productId: sql`excluded.product_id`,
            titleAtStore: sql`excluded.title_at_store`,
            priceCents: sql`excluded.price_cents`,
            originalPriceCents: sql`excluded.original_price_cents`,
            currency: sql`excluded.currency`,
            inStock: sql`excluded.in_stock`,
            url: sql`excluded.url`,
            imageUrl: sql`excluded.image_url`,
            lastCheckedAt: sql`excluded.last_checked_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning({ id: storeListings.id, externalId: storeListings.externalId });

      const listingIdByExternal = new Map(insertedListings.map((row) => [row.externalId, row.id]));

      for (const entry of listingBatch) {
        const listingId = listingIdByExternal.get(entry.item.externalId);
        const productId = effectiveProductIds.get(entry.item.externalId);
        if (!listingId || !productId) {
          skipped += 1;
          continue;
        }
        productIds.push(productId);
        const previous = existingInternal.get(entry.item.externalId);
        const changed =
          !previous ||
          previous.priceCents !== entry.item.priceCents ||
          previous.inStock !== entry.item.inStock;
        if (changed) changedProductIds.add(productId);
        processed.push({
          listingId,
          priceCents: entry.item.priceCents,
          inStock: entry.item.inStock,
          changed,
        });
      }
    } catch (error) {
      console.warn(
        `  ⚠️  ${storeSlug}: lote de listings ${batchIndex + 1} falló, reintentando fila por fila (${(error as Error).message.slice(0, 140)})`
      );
      for (const entry of listingBatch) {
        const productId = effectiveProductIds.get(entry.item.externalId);
        if (!productId) continue;
        try {
          const [row] = await db
            .insert(storeListings)
            .values(listingValues(entry, productId))
            .onConflictDoUpdate({
              target: [storeListings.storeId, storeListings.externalId],
              set: {
                productId: sql`excluded.product_id`,
                titleAtStore: sql`excluded.title_at_store`,
                priceCents: sql`excluded.price_cents`,
                originalPriceCents: sql`excluded.original_price_cents`,
                currency: sql`excluded.currency`,
                inStock: sql`excluded.in_stock`,
                url: sql`excluded.url`,
                imageUrl: sql`excluded.image_url`,
                lastCheckedAt: sql`excluded.last_checked_at`,
                updatedAt: sql`excluded.updated_at`,
              },
            })
            .returning({ id: storeListings.id });
          if (!row) {
            skipped += 1;
            continue;
          }
          productIds.push(productId);
          const previous = existingInternal.get(entry.item.externalId);
          const changed =
            !previous ||
            previous.priceCents !== entry.item.priceCents ||
            previous.inStock !== entry.item.inStock;
          if (changed) changedProductIds.add(productId);
          processed.push({
            listingId: row.id,
            priceCents: entry.item.priceCents,
            inStock: entry.item.inStock,
            changed,
          });
        } catch (itemError) {
          skipped += 1;
          if (skipped <= 5) {
            console.warn(
              `  ⚠️  ${storeSlug} · "${entry.item.title.slice(0, 60)}" no se pudo guardar: ${(itemError as Error).message.slice(0, 160)}`
            );
          }
        }
      }
    }

    if ((batchIndex + 1) % Math.max(1, Math.ceil(PROGRESS_EVERY / PRODUCT_BATCH_SIZE)) === 0) {
      console.log(
        `    … ${storeSlug}: ${Math.min((batchIndex + 1) * PRODUCT_BATCH_SIZE, prepared.length)}/${prepared.length} productos procesados`
      );
    }
  }

  // ---- Price history snapshots -------------------------------------------
  if (processed.length > 0) {
    const lastSnapshots = new Map<
      string,
      { priceCents: number; inStock: boolean; recordedAt: Date }
    >();

    for (const ids of chunk(
      processed.map((entry) => entry.listingId),
      HISTORY_READ_BATCH
    )) {
      const rows = await db
        .select({
          listingId: priceHistory.listingId,
          priceCents: priceHistory.priceCents,
          inStock: priceHistory.inStock,
          recordedAt: priceHistory.recordedAt,
        })
        .from(priceHistory)
        .where(inArray(priceHistory.listingId, ids))
        .orderBy(desc(priceHistory.recordedAt));

      for (const row of rows) {
        if (!lastSnapshots.has(row.listingId)) {
          lastSnapshots.set(row.listingId, {
            priceCents: row.priceCents,
            inStock: row.inStock,
            recordedAt: row.recordedAt,
          });
        }
      }
    }

    const toInsert = processed.filter((entry) => {
      const last = lastSnapshots.get(entry.listingId);
      if (!last) return true;
      if (last.priceCents !== entry.priceCents) return true;
      if (last.inStock !== entry.inStock) return true;
      return now.getTime() - last.recordedAt.getTime() >= HISTORY_MIN_INTERVAL_MS;
    });

    for (const batch of chunk(toInsert, HISTORY_WRITE_BATCH)) {
      if (batch.length === 0) continue;
      await db.insert(priceHistory).values(
        batch.map((entry) => ({
          listingId: entry.listingId,
          priceCents: entry.priceCents,
          inStock: entry.inStock,
          recordedAt: now,
        }))
      );
    }
  }

  // ---- Bump product freshness only when a price/stock really changed -----
  if (changedProductIds.size > 0) {
    for (const ids of chunk([...changedProductIds], HISTORY_READ_BATCH)) {
      await db.update(products).set({ updatedAt: now }).where(inArray(products.id, ids));
    }
  }

  // ---- Mark retired / sold-out listings -----------------------------------
  const healthyRun =
    items.length >= 50 && (previousListings === 0 || items.length >= previousListings * 0.6);

  if (!healthyRun && items.length >= 50 && previousListings > 0) {
    console.warn(
      `  ⚠️  ${storeSlug}: corrida incompleta (${items.length}/${previousListings} listings, <60%); no se marcan agotados`
    );
  }

  if (healthyRun && !options.signal?.aborted) {
    const seenExternalIds = [...new Set(items.map((item) => item.externalId))];
    // drizzle expands a JS array into a parameter list, so build a real ARRAY[].
    const seenArray = sql`ARRAY[${sql.join(
      seenExternalIds.map((externalId) => sql`${externalId}`),
      sql`, `
    )}]::text[]`;
    const stale = await db
      .update(storeListings)
      .set({ inStock: false, updatedAt: now })
      .where(
        and(
          eq(storeListings.storeId, storeId),
          eq(storeListings.inStock, true),
          sql`${storeListings.externalId} <> ALL(${seenArray})`
        )
      )
      .returning({ id: storeListings.id, priceCents: storeListings.priceCents });

    if (stale.length > 0) {
      for (const batch of chunk(stale, HISTORY_WRITE_BATCH)) {
        await db.insert(priceHistory).values(
          batch.map((row) => ({
            listingId: row.id,
            priceCents: row.priceCents,
            inStock: false,
            recordedAt: now,
          }))
        );
      }
      console.log(
        `  🚫 ${storeSlug}: ${stale.length} listings retirados/agotados marcados fuera de stock`
      );
    }
  }

  await db
    .update(stores)
    .set({ lastScrapedAt: now, updatedAt: now })
    .where(eq(stores.id, storeId));

  return {
    itemsFound: items.length,
    itemsUpserted: productIds.length,
    productIds,
    skipped,
  };
}
