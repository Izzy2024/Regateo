import { db, eq, products, stores, storeListings, sql } from "@regateo/db";
import { slugify } from "@regateo/shared";
import { deriveIdentity } from "./matching";

/**
 * One-off maintenance: separates products that the old family/token matcher
 * merged incorrectly (Sony BRAVIA 8 vs BRAVIA 2, Samsung 55" TV shelves, printer
 * vs toner, etc.).
 *
 * A product is re-keyed listing-by-listing with a deterministic scoped key
 * `${matchKey}::${storeSlug}-${externalId}` when:
 *   - its match key is a legacy brand+size / brand+capacity family key,
 *   - its cross-store price ratio is above 2.2x,
 *   - it has two listings from the same store (impossible for a single product),
 *   - it has no trusted model code but listings from 2+ stores,
 *   - its "model" is actually an IP rating or the brand itself.
 *
 * Run with: bun src/cleanup.ts
 */

const MAX_PRICE_RATIO = 2.2;

const LEGACY_FAMILY_KEY =
  /::(?:acc-)?(?:tv-\d+in|lavadora-|secadora-|refrigeradora-|congelador-|estufa-|horno-|microondas-|lavavajillas-|licuadora-|cafetera-|freidora-|aspiradora-|batidora-|tostadora-|arrocera-|olla-|plancha-|sandwichera-|ventilador-|aire-)/;

const BAD_MODEL = /^(?:IPX?\d{1,2}|LED|OLED|QLED|SMART|HDMI|USB)$/i;

interface ProductRow {
  id: string;
  matchKey: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: string;
  imageUrl: string | null;
  specs: Record<string, unknown> | null;
}

interface ListingRow {
  id: string;
  storeId: string;
  storeSlug: string;
  externalId: string;
  title: string;
  priceCents: number;
  originalPriceCents: number | null;
  inStock: boolean;
  url: string;
  imageUrl: string | null;
  lastCheckedAt: Date;
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

function scopedKey(matchKey: string, storeSlug: string, externalId: string): string {
  return `${matchKey}::${slugify(storeSlug)}-${slugify(externalId)}`.slice(0, 180);
}

function priceRatio(a: number, b: number): number {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return min > 0 ? max / min : Number.POSITIVE_INFINITY;
}

/** Detailed SKU-like codes inside a title (FA506NF-HN005W, 15-FC0287LA, …). */
function detailedModelCodes(title: string): string[] {
  const upper = title.toUpperCase();
  const candidates = upper.match(/[A-Z0-9][A-Z0-9_.-]{4,}/g) ?? [];
  return candidates.filter(
    (token) =>
      /[A-Z]/.test(token) &&
      /\d/.test(token) &&
      (token.includes("-") || token.length >= 8) &&
      !/^\d+$/.test(token)
  );
}

function suspicionReason(product: ProductRow, listings: ListingRow[]): string | null {
  // Already isolated by a previous cleanup/guardrail run.
  if (product.matchKey.split("::").length > 2) return null;
  if (product.specs && typeof product.specs.splitFrom === "string") return null;

  if (LEGACY_FAMILY_KEY.test(product.matchKey)) return "legacy-family-key";

  const storeIds = new Set(listings.map((listing) => listing.storeId));
  const prices = listings.map((listing) => listing.priceCents);
  const ratio = Math.max(...prices) / Math.min(...prices);
  if (ratio > MAX_PRICE_RATIO) return `price-ratio-${ratio.toFixed(2)}`;

  if (listings.length > storeIds.size) return "same-store-duplicates";

  if (!product.modelNumber && storeIds.size >= 2) return "no-model-signature";

  if (product.modelNumber) {
    // Same series token but different detailed SKU (A15 vs FA506NF-HN005W).
    const codes = new Set(listings.flatMap((listing) => detailedModelCodes(listing.title)));
    if (codes.size > 1) return "different-model-codes";

    // Same model but listings expose different variants (RAM/storage/size/panel).
    const variantKeys = new Set(
      listings.map(
        (listing) =>
          deriveIdentity({
            title: listing.title,
            vendor: product.brand,
            storeSlug: listing.storeSlug,
            modelNumber: product.modelNumber,
          }).matchKey
      )
    );
    if (variantKeys.size > 1) return "variant-mismatch";

    if (BAD_MODEL.test(product.modelNumber)) return "spec-as-model";
    if (
      product.brand &&
      product.modelNumber.toLowerCase().replace(/[^a-z0-9]/g, "") ===
        product.brand.toLowerCase().replace(/[^a-z0-9]/g, "")
    ) {
      return "brand-as-model";
    }
  }

  return null;
}

/**
 * Scoped products inherit the (possibly wrong) metadata of the merged product
 * they were split from. Recompute name/brand/model/category/specs from the
 * real listing title so "Sony BRAVIA 8 OLED 65\"" is not labelled "BRAVIA 2".
 */
async function repairScopedMetadata(): Promise<number> {
  const rows = await db
    .select({
      productId: products.id,
      matchKey: products.matchKey,
      specs: products.specs,
      listingTitle: storeListings.titleAtStore,
      storeSlug: stores.slug,
      imageUrl: storeListings.imageUrl,
    })
    .from(products)
    .innerJoin(storeListings, eq(storeListings.productId, products.id))
    .innerJoin(stores, eq(stores.id, storeListings.storeId))
    .where(sql`length(${products.matchKey}) - length(replace(${products.matchKey}, '::', '')) >= 4`);

  const byProduct = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row);
    byProduct.set(row.productId, list);
  }

  let repaired = 0;
  for (const list of byProduct.values()) {
    if (list.length !== 1) continue;
    const row = list[0]!;
    const identity = deriveIdentity({ title: row.listingTitle, storeSlug: row.storeSlug });
    const specs = {
      ...(row.specs ?? {}),
      ...identity.specs,
      metadataRepairedAt: new Date().toISOString(),
    };

    await db
      .update(products)
      .set({
        canonicalName: identity.canonicalName,
        brand: identity.brand,
        modelNumber: identity.modelNumber,
        category: identity.category,
        imageUrl: row.imageUrl ?? undefined,
        specs,
        embeddingText: [identity.brand, identity.canonicalName, identity.category, row.listingTitle]
          .filter(Boolean)
          .join(" | ")
          .slice(0, 1200),
        updatedAt: new Date(),
      })
      .where(eq(products.id, row.productId));

    repaired += 1;
    if (repaired % 250 === 0) console.log(`   … ${repaired} productos scoped reparados`);
  }

  return repaired;
}

async function main(): Promise<void> {
  console.log("🧹 Limpieza de fusiones falsas en regateoapp_dev");

  const rows = await db
    .select({
      productId: products.id,
      matchKey: products.matchKey,
      canonicalName: products.canonicalName,
      brand: products.brand,
      modelNumber: products.modelNumber,
      category: products.category,
      imageUrl: products.imageUrl,
      specs: products.specs,
      listingId: storeListings.id,
      storeId: storeListings.storeId,
      storeSlug: stores.slug,
      externalId: storeListings.externalId,
      title: storeListings.titleAtStore,
      priceCents: storeListings.priceCents,
      originalPriceCents: storeListings.originalPriceCents,
      inStock: storeListings.inStock,
      url: storeListings.url,
      listingImage: storeListings.imageUrl,
      lastCheckedAt: storeListings.lastCheckedAt,
    })
    .from(products)
    .innerJoin(storeListings, eq(storeListings.productId, products.id))
    .innerJoin(stores, eq(stores.id, storeListings.storeId));

  const byProduct = new Map<string, { product: ProductRow; listings: ListingRow[] }>();
  for (const row of rows) {
    const current = byProduct.get(row.productId) ?? {
      product: {
        id: row.productId,
        matchKey: row.matchKey,
        canonicalName: row.canonicalName,
        brand: row.brand,
        modelNumber: row.modelNumber,
        category: row.category,
        imageUrl: row.imageUrl,
        specs: row.specs ?? null,
      },
      listings: [],
    };
    current.listings.push({
      id: row.listingId,
      storeId: row.storeId,
      storeSlug: row.storeSlug,
      externalId: row.externalId,
      title: row.title,
      priceCents: row.priceCents,
      originalPriceCents: row.originalPriceCents,
      inStock: row.inStock,
      url: row.url,
      imageUrl: row.listingImage,
      lastCheckedAt: row.lastCheckedAt,
    });
    byProduct.set(row.productId, current);
  }

  const reasons = new Map<string, number>();
  const toSplit: Array<{ product: ProductRow; listings: ListingRow[]; reason: string }> = [];

  for (const entry of byProduct.values()) {
    const reason = suspicionReason(entry.product, entry.listings);
    if (!reason) continue;
    reasons.set(reason.replace(/-\d+\.\d+$/, ""), (reasons.get(reason.replace(/-\d+\.\d+$/, "")) ?? 0) + 1);
    toSplit.push({ ...entry, reason });
  }

  console.log(`   productos revisados: ${byProduct.size}`);
  console.log(`   productos a separar: ${toSplit.length}`);
  console.log(`   motivos: ${JSON.stringify([...reasons.entries()])}`);

  let movedListings = 0;
  let createdProducts = 0;
  let processed = 0;

  for (const entry of toSplit) {
    const { product, listings } = entry;

    for (const listing of listings) {
      const key = scopedKey(product.matchKey, listing.storeSlug, listing.externalId);
      const baseSlug =
        slugify(product.canonicalName).slice(0, 108) || slugify(product.modelNumber ?? "producto");
      let slug = `${baseSlug}-${shortHash(key)}`;
      let attempt = 0;
      while (attempt < 5) {
        const [clash] = await db
          .select({ id: products.id, matchKey: products.matchKey })
          .from(products)
          .where(eq(products.slug, slug))
          .limit(1);
        if (!clash || clash.matchKey === key) break;
        attempt += 1;
        slug = `${baseSlug.slice(0, 100)}-${shortHash(`${key}:${attempt}`)}`;
      }

      const [scoped] = await db
        .insert(products)
        .values({
          slug,
          matchKey: key,
          canonicalName: product.canonicalName,
          brand: product.brand,
          modelNumber: product.modelNumber,
          category: product.category,
          imageUrl: product.imageUrl,
          specs: {
            ...(product.specs ?? {}),
            splitReason: entry.reason,
            splitFrom: product.matchKey,
          },
        })
        .onConflictDoUpdate({
          target: products.matchKey,
          set: { updatedAt: new Date() },
        })
        .returning({ id: products.id });

      if (!scoped) continue;
      if (scoped.id !== product.id) createdProducts += 1;

      await db
        .update(storeListings)
        .set({ productId: scoped.id, updatedAt: new Date() })
        .where(eq(storeListings.id, listing.id));
      movedListings += 1;
    }

    // Only delete when every listing actually moved (never cascade real data).
    const [remaining] = await db
      .select({ id: storeListings.id })
      .from(storeListings)
      .where(eq(storeListings.productId, product.id))
      .limit(1);
    if (!remaining) {
      await db.delete(products).where(eq(products.id, product.id));
    }

    processed += 1;
    if (processed % 100 === 0) {
      console.log(
        `   … ${processed}/${toSplit.length} productos separados · ${movedListings} listings reubicados`
      );
    }
  }

  await db.execute(
    sql`DELETE FROM products p WHERE NOT EXISTS (SELECT 1 FROM store_listings sl WHERE sl.product_id = p.id)`
  );

  console.log(`   listings reubicados: ${movedListings}`);
  console.log(`   productos scoped creados: ${createdProducts}`);
  console.log("   huérfanos eliminados: verificados");

  const repaired = await repairScopedMetadata();
  console.log(`   metadata scoped reparada: ${repaired}`);
  console.log("✅ Limpieza terminada");
}

try {
  await main();
} catch (error) {
  console.error(`❌ Limpieza falló: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  const { sqlClient } = await import("@regateo/db");
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}
