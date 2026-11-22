import { db, sql } from "@regateo/db";
import {
  canonicalGalaxyKey,
  canonicalIphoneKey,
  looksLikeModelToken,
  normalizeGtin,
} from "./matching";
import { refreshProductAggregates } from "./refresh-stats";

/**
 * Descubrimiento asistido de candidatos multi-tienda.
 *
 * Usa `pg_trgm` (`similarity()`) para proponer pares de productos de tiendas
 * distintas que podrían ser el mismo artículo. Solo se fusionan los pares que
 * pasan reglas estrictas de precisión (marca + modelo/serie + almacenamiento +
 * tamaño + panel + ratio ≤1.65 + no accesorio + tiendas disjuntas).
 * Los embeddings (pgvector) quedan como siguiente capa si hay API key.
 */

export const CANDIDATE_CATEGORIES = ["celulares", "televisores", "computadoras"] as const;

export interface CandidateView {
  id: string;
  matchKey: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: string;
  specs: Record<string, unknown> | null;
  bestPriceCents: number | null;
  storeSlugs: string[];
}

export interface CandidateDecision {
  ok: boolean;
  reason: string;
}

const MAX_PRICE_RATIO = 1.65;
const MIN_TITLE_SIMILARITY = 0.35;

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Model-like tokens inside a canonical name (S25, A17, U8000F, 15-FC0287LA). */
export function candidateSeriesTokens(name: string): string[] {
  const tokens = name.toUpperCase().match(/[A-Z0-9][A-Z0-9.\-]{1,}/g) ?? [];
  return [...new Set(tokens.filter((token) => looksLikeModelToken(token)))];
}

function specString(view: CandidateView, key: string): string | null {
  const value = view.specs?.[key];
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : null;
}

/** Screen size from a canonical name (13", 15.6", 27 pulgadas). */
export function candidateScreenSize(name: string): number | null {
  const match = name.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:"|”|pulgadas|pulg\.?|inch)/i);
  if (!match?.[1]) return null;
  const size = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(size) && size >= 5 && size <= 150 ? size : null;
}

function specNumber(view: CandidateView, key: string): number | null {
  const value = view.specs?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reglas estrictas de fusión. Devuelve `{ ok, reason }` para poder auditar y
 * testear cada rechazo sin tocar la base de datos.
 */
export function candidateCompatibility(
  a: CandidateView,
  b: CandidateView,
  options: { similarity?: number; minSimilarity?: number } = {}
): CandidateDecision {
  if (a.id === b.id) return { ok: false, reason: "same-product" };
  if (a.category !== b.category) return { ok: false, reason: "category-mismatch" };
  if (!(CANDIDATE_CATEGORIES as readonly string[]).includes(a.category)) {
    return { ok: false, reason: "category-not-candidate" };
  }
  if (a.specs?.isAccessory === true || b.specs?.isAccessory === true) {
    return { ok: false, reason: "accessory" };
  }

  const brandA = normalize(a.brand);
  const brandB = normalize(b.brand);
  if (!brandA || brandA !== brandB) return { ok: false, reason: "brand-mismatch" };

  if (a.storeSlugs.some((slug) => b.storeSlugs.includes(slug))) {
    return { ok: false, reason: "shared-store" };
  }

  const gtinA = normalizeGtin((a.specs?.gtin as string) ?? null);
  const gtinB = normalizeGtin((b.specs?.gtin as string) ?? null);
  const sameGtin = Boolean(gtinA && gtinB && gtinA === gtinB);
  if (gtinA && gtinB && gtinA !== gtinB) return { ok: false, reason: "gtin-mismatch" };

  const storageA = specString(a, "storage");
  const storageB = specString(b, "storage");
  if (storageA && storageB && storageA !== storageB) {
    return { ok: false, reason: "storage-mismatch" };
  }

  const sizeA =
    specNumber(a, "screenSizeInches") ?? candidateScreenSize(a.canonicalName);
  const sizeB =
    specNumber(b, "screenSizeInches") ?? candidateScreenSize(b.canonicalName);
  if (sizeA && sizeB && sizeA !== sizeB) return { ok: false, reason: "size-mismatch" };

  const panelA = specString(a, "panelTechnology");
  const panelB = specString(b, "panelTechnology");
  if (panelA && panelB && panelA !== panelB) return { ok: false, reason: "panel-mismatch" };

  // iPhone/Galaxy tier and storage must agree exactly (Pro ≠ Pro Max, FE ≠ plain).
  const iphoneA = canonicalIphoneKey(a.canonicalName);
  const iphoneB = canonicalIphoneKey(b.canonicalName);
  if (iphoneA && iphoneB && iphoneA !== iphoneB) {
    return { ok: false, reason: "iphone-variant-mismatch" };
  }
  const galaxyA = canonicalGalaxyKey(a.canonicalName);
  const galaxyB = canonicalGalaxyKey(b.canonicalName);
  if (galaxyA && galaxyB && galaxyA !== galaxyB) {
    return { ok: false, reason: "galaxy-variant-mismatch" };
  }

  if (!sameGtin) {
    const modelA = normalize(a.modelNumber).replace(/[^a-z0-9]/g, "");
    const modelB = normalize(b.modelNumber).replace(/[^a-z0-9]/g, "");
    if (modelA && modelB) {
      if (modelA !== modelB) return { ok: false, reason: "model-mismatch" };
    } else {
      const seriesB = new Set(candidateSeriesTokens(b.canonicalName));
      const shared = candidateSeriesTokens(a.canonicalName).filter((token) => seriesB.has(token));
      if (shared.length === 0) return { ok: false, reason: "no-shared-series" };
    }
  }

  const priceA = a.bestPriceCents;
  const priceB = b.bestPriceCents;
  if (!priceA || !priceB || priceA <= 0 || priceB <= 0) {
    return { ok: false, reason: "missing-price" };
  }
  const ratio = Math.max(priceA, priceB) / Math.min(priceA, priceB);
  if (ratio > MAX_PRICE_RATIO) {
    return { ok: false, reason: `price-ratio-${ratio.toFixed(2)}` };
  }

  const minSimilarity = options.minSimilarity ?? MIN_TITLE_SIMILARITY;
  if (options.similarity !== undefined && options.similarity < minSimilarity) {
    return { ok: false, reason: "low-title-similarity" };
  }

  return { ok: true, reason: "ok" };
}

interface CandidateRow extends Record<string, unknown> {
  a_id: string;
  a_key: string;
  a_name: string;
  a_brand: string | null;
  a_model: string | null;
  a_category: string;
  a_specs: Record<string, unknown> | null;
  a_best: number | null;
  a_stores: string[];
  b_id: string;
  b_key: string;
  b_name: string;
  b_brand: string | null;
  b_model: string | null;
  b_category: string;
  b_specs: Record<string, unknown> | null;
  b_best: number | null;
  b_stores: string[];
  similarity: number;
}

async function ensureTrigram(): Promise<boolean> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    return true;
  } catch {
    return false;
  }
}

async function loadCandidatePairs(useSimilarity: boolean): Promise<CandidateRow[]> {
  const similaritySelect = useSimilarity
    ? sql`similarity(a.canonical_name, b.canonical_name)::float AS similarity`
    : sql`1.0::float AS similarity`;
  const similarityFilter = useSimilarity
    ? sql`AND similarity(a.canonical_name, b.canonical_name) >= ${MIN_TITLE_SIMILARITY}`
    : sql``;

  const rows = await db.execute<CandidateRow>(sql`
    SELECT a.id AS a_id,
           a.match_key AS a_key,
           a.canonical_name AS a_name,
           a.brand AS a_brand,
           a.model_number AS a_model,
           a.category AS a_category,
           a.specs AS a_specs,
           a.best_price_cents AS a_best,
           (SELECT array_agg(DISTINCT s.slug) FROM store_listings sl JOIN stores s ON s.id = sl.store_id WHERE sl.product_id = a.id) AS a_stores,
           b.id AS b_id,
           b.match_key AS b_key,
           b.canonical_name AS b_name,
           b.brand AS b_brand,
           b.model_number AS b_model,
           b.category AS b_category,
           b.specs AS b_specs,
           b.best_price_cents AS b_best,
           (SELECT array_agg(DISTINCT s.slug) FROM store_listings sl JOIN stores s ON s.id = sl.store_id WHERE sl.product_id = b.id) AS b_stores,
           ${similaritySelect}
    FROM products a
    JOIN products b
      ON a.id < b.id
     AND a.category = b.category
    WHERE a.category IN ('celulares','televisores','computadoras')
      AND a.brand IS NOT NULL
      AND b.brand IS NOT NULL
      AND lower(a.brand) = lower(b.brand)
      AND COALESCE(a.best_price_cents, 0) > 0
      AND COALESCE(b.best_price_cents, 0) > 0
      AND GREATEST(a.best_price_cents, b.best_price_cents)::numeric
          / LEAST(a.best_price_cents, b.best_price_cents) <= ${MAX_PRICE_RATIO}
      ${similarityFilter}
      AND NOT EXISTS (
        SELECT 1
        FROM store_listings sa
        JOIN store_listings sb ON sb.store_id = sa.store_id
        WHERE sa.product_id = a.id AND sb.product_id = b.id
      )
    ORDER BY similarity DESC, a.id
    LIMIT 500
  `);

  return Array.from(rows as unknown as CandidateRow[]);
}

async function coverageByCategory(): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    SELECT p.category,
           count(*)::int AS count
    FROM products p
    WHERE p.store_count >= 2
      AND p.category IN ('celulares','televisores','computadoras')
    GROUP BY p.category
  `);
  const output: Record<string, number> = { celulares: 0, televisores: 0, computadoras: 0 };
  for (const row of Array.from(rows as unknown as Array<{ category: string; count: number }>)) {
    output[row.category] = Number(row.count);
  }
  return output;
}

async function main(): Promise<void> {
  console.log("🔎 Candidatos multi-tienda (pg_trgm + reglas estrictas)");

  const before = await coverageByCategory();
  console.log(`   ANTES  → celulares ${before.celulares} · TV ${before.televisores} · laptops ${before.computadoras}`);

  const useSimilarity = await ensureTrigram();
  if (!useSimilarity) {
    console.log("   ⚠️  pg_trgm no disponible: se usan solo reglas de modelo/marca");
  }

  const pairs = await loadCandidatePairs(useSimilarity);
  console.log(`   pares pre-filtrados por PostgreSQL: ${pairs.length}`);

  const merged: string[] = [];
  const reasons = new Map<string, number>();
  const deleted = new Set<string>();

  for (const row of pairs) {
    if (deleted.has(row.a_id) || deleted.has(row.b_id)) continue;

    const a: CandidateView = {
      id: row.a_id,
      matchKey: row.a_key,
      canonicalName: row.a_name,
      brand: row.a_brand,
      modelNumber: row.a_model,
      category: row.a_category,
      specs: row.a_specs,
      bestPriceCents: row.a_best,
      storeSlugs: row.a_stores ?? [],
    };
    const b: CandidateView = {
      id: row.b_id,
      matchKey: row.b_key,
      canonicalName: row.b_name,
      brand: row.b_brand,
      modelNumber: row.b_model,
      category: row.b_category,
      specs: row.b_specs,
      bestPriceCents: row.b_best,
      storeSlugs: row.b_stores ?? [],
    };
    const decision = candidateCompatibility(a, b, { similarity: row.similarity });
    if (!decision.ok) {
      const key = decision.reason.replace(/-[0-9.]+$/, "");
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
      continue;
    }

    // Keep the product with more stores (richer data); tie → lower id.
    const [target, source] =
      a.storeSlugs.length >= b.storeSlugs.length ? [a, b] : [b, a];

    await db.execute(sql`
      UPDATE store_listings
      SET product_id = ${target.id}, updated_at = now()
      WHERE product_id = ${source.id}
    `);

    const [remaining] = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM store_listings WHERE product_id = ${source.id}
    `);
    if (Number(Array.from(remaining as unknown as Array<{ count: number }>)[0]?.count ?? 0) === 0) {
      const refs = await db.execute<{ count: number }>(sql`
        SELECT (
          (SELECT count(*) FROM price_alerts WHERE product_id = ${source.id}) +
          (SELECT count(*) FROM user_favorites WHERE product_id = ${source.id})
        )::int AS count
      `);
      const referenced = Number(
        Array.from(refs as unknown as Array<{ count: number }>)[0]?.count ?? 0
      );
      if (referenced === 0) {
        await db.execute(sql`DELETE FROM products WHERE id = ${source.id}`);
        deleted.add(source.id);
      }
    }

    await db.execute(sql`
      UPDATE products
      SET canonical_name = CASE
            WHEN length(canonical_name) >= length(${source.canonicalName}) THEN canonical_name
            ELSE ${source.canonicalName}
          END,
          brand = COALESCE(brand, ${source.brand}),
          updated_at = now()
      WHERE id = ${target.id}
    `);

    merged.push(`${source.matchKey} → ${target.matchKey}`);
    console.log(
      `   ✅ ${a.category}: ${source.canonicalName.slice(0, 60)} → ${target.matchKey}`
    );
  }

  const refreshed = await refreshProductAggregates();
  const after = await coverageByCategory();

  console.log(`   agregados refrescados: ${refreshed} productos`);
  console.log(`   fusiones aplicadas: ${merged.length}`);
  if (reasons.size > 0) {
    console.log(
      `   rechazos: ${[...reasons.entries()]
        .sort((x, y) => y[1] - x[1])
        .map(([reason, count]) => `${reason}=${count}`)
        .join(" · ")}`
    );
  }
  console.log(
    `   DESPUÉS → celulares ${after.celulares} (+${after.celulares - before.celulares}) · TV ${
      after.televisores
    } (+${after.televisores - before.televisores}) · laptops ${after.computadoras} (+${
      after.computadoras - before.computadoras
    })`
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`❌ Candidatos falló: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    const { sqlClient } = await import("@regateo/db");
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  }
}
