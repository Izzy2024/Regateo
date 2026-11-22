import { db, sql } from "@regateo/db";

/**
 * Materialización de agregados de precio en `products`.
 *
 * Una sola sentencia `UPDATE products ... FROM (SELECT ... GROUP BY product_id)`
 * recalcula best/highest/savings/store counts para todos los productos (o solo
 * los indicados). Se ejecuta al final de cada ingesta, de cada re-agrupamiento y
 * de la fusión de candidatos, para que la API pueda consultar precios en O(1).
 */

function uuidArray(ids: string[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )}]::uuid[]`;
}

function countFrom(rows: unknown): number {
  const list = Array.from(rows as unknown as Array<{ count?: number }>);
  return Number(list[0]?.count ?? 0);
}

/**
 * Recalcula los agregados y devuelve cuántos productos se actualizaron.
 * Sin `productIds` refresca todo el catálogo.
 */
export async function refreshProductAggregates(productIds?: string[]): Promise<number> {
  const ids = productIds
    ? [...new Set(productIds.filter((id) => typeof id === "string" && id.length > 0))]
    : undefined;

  if (ids && ids.length === 0) return 0;

  const listingsFilter = ids ? sql`WHERE sl.product_id = ANY(${uuidArray(ids)})` : sql``;
  const productsFilter = ids ? sql`AND p.id = ANY(${uuidArray(ids)})` : sql``;

  const updated = await db.execute(sql`
    WITH agg AS (
      SELECT sl.product_id,
             min(sl.price_cents) FILTER (WHERE sl.in_stock) AS min_in_stock,
             min(sl.price_cents) AS min_any,
             max(sl.price_cents) FILTER (WHERE sl.in_stock) AS max_in_stock,
             max(sl.price_cents) AS max_any,
             count(DISTINCT sl.store_id)::int AS store_count,
             count(*) FILTER (WHERE sl.in_stock)::int AS in_stock_count,
             count(DISTINCT sl.store_id) FILTER (WHERE sl.in_stock)::int AS in_stock_stores
      FROM store_listings sl
      ${listingsFilter}
      GROUP BY sl.product_id
    ),
    winner AS (
      SELECT DISTINCT ON (sl.product_id)
             sl.product_id,
             sl.price_cents AS winner_price,
             sl.original_price_cents AS winner_original
      FROM store_listings sl
      ${listingsFilter}
      ${ids ? sql`AND` : sql`WHERE`} sl.in_stock = true
      ORDER BY sl.product_id, sl.price_cents ASC, sl.id ASC
    ),
    calc AS (
      SELECT agg.*,
             winner.winner_price,
             winner.winner_original,
             CASE
               WHEN agg.in_stock_stores >= 2
               THEN GREATEST(
                 COALESCE(agg.max_in_stock, agg.max_any) -
                 COALESCE(agg.min_in_stock, agg.min_any),
                 0
               )
               ELSE 0
             END AS savings_cents
      FROM agg
      LEFT JOIN winner ON winner.product_id = agg.product_id
    ),
    updated AS (
      UPDATE products p SET
        best_price_cents = COALESCE(c.min_in_stock, c.min_any),
        highest_price_cents = COALESCE(c.max_in_stock, c.max_any),
        store_count = c.store_count,
        in_stock_count = c.in_stock_count,
        savings_cents = c.savings_cents,
        savings_percent = CASE
          WHEN c.savings_cents > 0 AND COALESCE(c.max_in_stock, c.max_any) > 0
          THEN LEAST(99, round(100.0 * c.savings_cents / COALESCE(c.max_in_stock, c.max_any), 2))
          ELSE 0
        END,
        store_discount_cents = CASE
          WHEN c.winner_original IS NOT NULL
           AND c.winner_price IS NOT NULL
           AND c.winner_original > c.winner_price
           AND (c.winner_original - c.winner_price)::numeric / c.winner_original <= 0.65
          THEN c.winner_original - c.winner_price
          ELSE 0
        END,
        store_discount_percent = CASE
          WHEN c.winner_original IS NOT NULL
           AND c.winner_price IS NOT NULL
           AND c.winner_original > c.winner_price
           AND (c.winner_original - c.winner_price)::numeric / c.winner_original <= 0.65
          THEN round(100.0 * (c.winner_original - c.winner_price) / c.winner_original, 2)
          ELSE 0
        END
      FROM calc c
      WHERE p.id = c.product_id
      ${productsFilter}
      RETURNING p.id
    )
    SELECT count(*)::int AS count FROM updated
  `);

  let total = countFrom(updated);

  // Productos sin listings (p. ej. favoritos huérfanos): stats en cero, nunca NULL.
  const emptied = await db.execute(sql`
    WITH updated AS (
      UPDATE products p SET
        best_price_cents = 0,
        highest_price_cents = 0,
        store_count = 0,
        in_stock_count = 0,
        savings_cents = 0,
        savings_percent = 0,
        store_discount_cents = 0,
        store_discount_percent = 0
      WHERE p.best_price_cents IS NULL
      ${productsFilter}
      RETURNING 1
    )
    SELECT count(*)::int AS count FROM updated
  `);

  total += countFrom(emptied);
  return total;
}

if (import.meta.main) {
  const started = Date.now();
  const updated = await refreshProductAggregates();
  console.log(
    `📊 Agregados materializados: ${updated} productos en ${((Date.now() - started) / 1000).toFixed(2)}s`
  );
  const { sqlClient } = await import("@regateo/db");
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}
