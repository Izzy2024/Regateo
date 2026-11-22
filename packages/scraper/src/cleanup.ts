import { db, eq, products, stores, storeListings, sql } from "@regateo/db";
import { slugify } from "@regateo/shared";
import { deriveIdentity } from "./matching";
import { refreshProductAggregates } from "./refresh-stats";

/**
 * Re-agrupamiento completo de `regateoapp_dev` con el matcher estricto actual.
 *
 * Recalcula el `match_key` de los 13k+ listings existentes (sin re-scrapear),
 * respeta el guardrail de precio 2.2x y vuelve a construir los productos:
 *
 *   - un producto por (matchKey, cluster de precio ≤2.2x),
 *   - máximo un listing por tienda dentro de un producto,
 *   - listings sobrantes aislados con `${matchKey}::${storeSlug}-${externalId}`.
 *
 * Los productos existentes se reutilizan por `match_key` (conserva ids, slugs y
 * favoritos/alertas); solo se borran huérfanos sin referencias.
 *
 * Ejecutar: `bun src/cleanup.ts` (desde packages/scraper)
 */

const MAX_PRICE_RATIO = 2.2;
const PRODUCT_BATCH = 120;
const LISTING_BATCH = 400;

interface ListingRow {
  id: string;
  storeId: string;
  storeSlug: string;
  externalId: string;
  title: string;
  priceCents: number;
  inStock: boolean;
  imageUrl: string | null;
  /** Brand hint from the current product (title brands always win). */
  brand: string | null;
  /** API-provided model (PTYTEC/DoitCenter) when the title confirms it. */
  modelNumber: string | null;
}

interface Cluster {
  key: string;
  listings: ListingRow[];
  stores: Set<string>;
  minPrice: number;
  maxPrice: number;
  /**
   * A same-store duplicate (e.g. another color of the same iPhone) becomes a
   * one-listing product: it must never absorb offers from other stores, which
   * would create a fake comparison between two different colors.
   */
  isolated: boolean;
}

interface ProductRow {
  id: string;
  matchKey: string;
  slug: string;
}

function shortHash(value: string): string {
  let fnv = 0x811c9dc5;
  let sdbm = 0x1000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    sdbm = (Math.imul(sdbm, 0x1000193) + code) >>> 0;
  }
  return `${fnv.toString(36)}${sdbm.toString(36)}`.slice(0, 10);
}

function scopedKey(baseKey: string, listing: ListingRow): string {
  return `${baseKey}::${slugify(listing.storeSlug)}-${slugify(listing.externalId)}`.slice(0, 180);
}

function ratioFits(cluster: Cluster, priceCents: number): boolean {
  const min = Math.min(cluster.minPrice, priceCents);
  const max = Math.max(cluster.maxPrice, priceCents);
  return min > 0 && max / min <= MAX_PRICE_RATIO;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function slugFor(identityName: string, key: string, taken: Map<string, string>): string {
  const base = slugify(identityName).slice(0, 118) || "producto";
  let slug = `${base}-${shortHash(key)}`;
  let attempt = 0;
  while (taken.has(slug) && taken.get(slug) !== key && attempt < 5) {
    attempt += 1;
    slug = `${base.slice(0, 100)}-${shortHash(`${key}:${attempt}`)}`;
  }
  taken.set(slug, key);
  return slug;
}

async function countMultiStore(): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM (
      SELECT product_id FROM store_listings
      GROUP BY product_id HAVING count(DISTINCT store_id) >= 2
    ) x
  `);
  return Number((Array.from(rows as unknown as Array<{ count: number }>)[0]?.count ?? 0));
}

async function countMultiByCategory(category: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM (
      SELECT p.id FROM products p
      JOIN store_listings sl ON sl.product_id = p.id
      WHERE p.category = ${category}
      GROUP BY p.id HAVING count(DISTINCT sl.store_id) >= 2
    ) x
  `);
  return Number((Array.from(rows as unknown as Array<{ count: number }>)[0]?.count ?? 0));
}

async function main(): Promise<void> {
  console.log("🧹 Re-agrupamiento estricto de regateoapp_dev");

  const before = {
    products: Number(
      (
        await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM products`)
      )[0]?.count ?? 0
    ),
    listings: Number(
      (
        await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM store_listings`)
      )[0]?.count ?? 0
    ),
    multiStore: await countMultiStore(),
    celulares: await countMultiByCategory("celulares"),
    televisores: await countMultiByCategory("televisores"),
    computadoras: await countMultiByCategory("computadoras"),
  };
  console.log(
    `   ANTES: ${before.products} productos · ${before.listings} listings · ${before.multiStore} comparables (2+ tiendas) · celulares ${before.celulares} · TV ${before.televisores} · laptops ${before.computadoras}`
  );

  // ---- 1. Recalcular identidad de cada listing ----------------------------
  const rows = await db
    .select({
      id: storeListings.id,
      storeId: storeListings.storeId,
      storeSlug: stores.slug,
      externalId: storeListings.externalId,
      title: storeListings.titleAtStore,
      priceCents: storeListings.priceCents,
      inStock: storeListings.inStock,
      imageUrl: storeListings.imageUrl,
      brand: products.brand,
      modelNumber: products.modelNumber,
    })
    .from(storeListings)
    .innerJoin(stores, eq(stores.id, storeListings.storeId))
    .innerJoin(products, eq(products.id, storeListings.productId));

  const groups = new Map<string, ListingRow[]>();
  const colorByListing = new Map<string, string | null>();
  for (const row of rows) {
    // Keep cleanup consistent with ingest for API-provided models, but only
    // when the title really contains that model (guards against stale merges).
    const titleKey = row.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const modelKey = (row.modelNumber ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const modelHint = modelKey.length >= 4 && titleKey.includes(modelKey) ? row.modelNumber : null;

    const identity = deriveIdentity({
      title: row.title,
      storeSlug: row.storeSlug,
      vendor: row.brand,
      modelNumber: modelHint,
    });
    const color =
      typeof identity.specs.color === "string" ? identity.specs.color : null;
    colorByListing.set(row.id, color);
    const list = groups.get(identity.matchKey) ?? [];
    list.push(row);
    groups.set(identity.matchKey, list);
  }

  // ---- 2. Clusterizar por precio (guardrail 2.2x) y una oferta por tienda --
  const clusters: Cluster[] = [];
  for (const [baseKey, listings] of groups) {
    const sorted = [...listings].sort((a, b) => {
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
      return a.storeSlug.localeCompare(b.storeSlug) || a.externalId.localeCompare(b.externalId);
    });

    const local: Cluster[] = [];
    for (const listing of sorted) {
      let target = local.find(
        (cluster) =>
          !cluster.isolated &&
          !cluster.stores.has(listing.storeSlug) &&
          ratioFits(cluster, listing.priceCents)
      );
      if (!target) {
        const sameStoreExists = local.some((cluster) => cluster.stores.has(listing.storeSlug));
        target = {
          key: local.length === 0 ? baseKey : scopedKey(baseKey, listing),
          listings: [],
          stores: new Set<string>(),
          minPrice: listing.priceCents,
          maxPrice: listing.priceCents,
          isolated: sameStoreExists,
        };
        local.push(target);
      }
      target.listings.push(listing);
      target.stores.add(listing.storeSlug);
      target.minPrice = Math.min(target.minPrice, listing.priceCents);
      target.maxPrice = Math.max(target.maxPrice, listing.priceCents);
    }
    clusters.push(...local);
  }

  console.log(`   grupos recalculados: ${clusters.length} productos destino`);

  // ---- 3. Reutilizar productos existentes por match_key -------------------
  const existing = await db
    .select({ id: products.id, matchKey: products.matchKey, slug: products.slug })
    .from(products);
  const existingByKey = new Map<string, ProductRow>(
    existing.map((row) => [row.matchKey, row])
  );
  const takenSlugs = new Map<string, string>(
    existing.map((row) => [row.slug, row.matchKey])
  );

  const idByKey = new Map<string, string>();
  const toCreate: Array<typeof products.$inferInsert> = [];

  for (const cluster of clusters) {
    const reused = existingByKey.get(cluster.key);
    if (reused) {
      idByKey.set(cluster.key, reused.id);
      continue;
    }

    const representative = cluster.listings[0]!;
    const identity = deriveIdentity({
      title: representative.title,
      storeSlug: representative.storeSlug,
    });
    toCreate.push({
      slug: slugFor(identity.canonicalName, cluster.key, takenSlugs),
      matchKey: cluster.key,
      canonicalName: identity.canonicalName,
      brand: identity.brand,
      modelNumber: identity.modelNumber,
      category: identity.category,
      imageUrl: representative.imageUrl,
      specs: {
        ...identity.specs,
        regroupedAt: new Date().toISOString(),
      },
      embeddingText: [
        identity.brand,
        identity.canonicalName,
        identity.category,
        representative.title,
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1200),
    });
  }

  for (const batch of chunk(toCreate, PRODUCT_BATCH)) {
    const inserted = await db
      .insert(products)
      .values(batch)
      .onConflictDoUpdate({
        target: products.matchKey,
        set: { updatedAt: new Date() },
      })
      .returning({ id: products.id, matchKey: products.matchKey });
    for (const row of inserted) idByKey.set(row.matchKey, row.id);
  }

  // ---- 4. Reasignar listings en bloque ------------------------------------
  const pairs: Array<[string, string]> = [];
  for (const cluster of clusters) {
    const productId = idByKey.get(cluster.key);
    if (!productId) continue;
    for (const listing of cluster.listings) pairs.push([listing.id, productId]);
  }

  for (const batch of chunk(pairs, LISTING_BATCH)) {
    const values = batch.map(
      ([listingId, productId]) =>
        sql`(${listingId}::uuid, ${productId}::uuid, ${colorByListing.get(listingId) ?? null})`
    );
    await db.execute(sql`
      UPDATE store_listings AS sl
      SET product_id = v.product_id,
          color = COALESCE(v.color, sl.color),
          updated_at = now()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(listing_id, product_id, color)
      WHERE sl.id = v.listing_id
    `);
  }
  console.log(`   listings reasignados: ${pairs.length}`);

  // ---- 5. Borrar huérfanos sin referencias (favoritos/alertas protegidos) --
  const deleted = await db.execute(sql`
    DELETE FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM store_listings sl WHERE sl.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM user_favorites f WHERE f.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM price_alerts a WHERE a.product_id = p.id)
  `);
  console.log(`   productos huérfanos eliminados: ${(deleted as unknown as { count?: number }).count ?? "ok"}`);

  const refreshed = await refreshProductAggregates();
  console.log(`   agregados materializados: ${refreshed} productos`);

  // ---- 6. Reporte ANTES vs DESPUÉS ---------------------------------------
  const after = {
    products: Number(
      (
        await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM products`)
      )[0]?.count ?? 0
    ),
    listings: Number(
      (
        await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM store_listings`)
      )[0]?.count ?? 0
    ),
    multiStore: await countMultiStore(),
    celulares: await countMultiByCategory("celulares"),
    televisores: await countMultiByCategory("televisores"),
    computadoras: await countMultiByCategory("computadoras"),
  };

  console.log(
    `   DESPUÉS: ${after.products} productos · ${after.listings} listings · ${after.multiStore} comparables (2+ tiendas) · celulares ${after.celulares} · TV ${after.televisores} · laptops ${after.computadoras}`
  );
  console.log(
    `   Δ comparables: ${before.multiStore} → ${after.multiStore} (${
      before.multiStore > 0
        ? `${(((after.multiStore - before.multiStore) / before.multiStore) * 100).toFixed(1)}%`
        : "n/a"
    })`
  );

  const top = await db.execute<{
    match_key: string;
    tiendas: number;
    ofertas: string;
    ratio: number;
  }>(sql`
    SELECT p.match_key,
           count(DISTINCT sl.store_id)::int AS tiendas,
           string_agg(s.slug || ' $' || to_char(sl.price_cents / 100.0, 'FM999999.00'), ' · ' ORDER BY sl.price_cents) AS ofertas,
           round(max(sl.price_cents)::numeric / NULLIF(min(sl.price_cents), 0), 2) AS ratio
    FROM products p
    JOIN store_listings sl ON sl.product_id = p.id
    JOIN stores s ON s.id = sl.store_id
    GROUP BY p.id
    HAVING count(DISTINCT sl.store_id) >= 2
    ORDER BY tiendas DESC, ratio DESC
    LIMIT 15
  `);
  console.log("\n   TOP 15 comparables multi-tienda:");
  console.table(Array.from(top as unknown as Array<Record<string, unknown>>));

  const bad = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM (
      SELECT p.id FROM products p JOIN store_listings sl ON sl.product_id = p.id
      GROUP BY p.id
      HAVING max(sl.price_cents)::numeric / NULLIF(min(sl.price_cents), 0) > 2.2
    ) x
  `);
  console.log(
    `   productos con ratio > 2.2: ${(Array.from(bad as unknown as Array<{ count: number }>)[0]?.count ?? 0)}`
  );
}

try {
  await main();
} catch (error) {
  console.error(`❌ Re-agrupamiento falló: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  const { sqlClient } = await import("@regateo/db");
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}
