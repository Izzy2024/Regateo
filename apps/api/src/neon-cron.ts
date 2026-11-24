// ============================================================================
// Neon Function entrypoint: `cron` (Scheduled price refresh, stale link cleanup & alerts)
// Triggered by Neon Function Trigger (`type: "schedule"` — cada 3 días 03:00 AM Panamá).
// Authenticates deliveries with `parseTriggerDelivery` from `@neon/functions/triggers`.
// ============================================================================
import { parseTriggerDelivery } from "@neon/functions/triggers";
import {
  evaluateAndDispatchPriceAlerts,
  refreshProductAggregates,
  runScrapePipeline,
  type ScrapeRunSummary,
} from "@regateo/scraper";
import { db, eq, inArray, sql, stores } from "@regateo/db";
import { cacheInvalidatePrefix } from "./lib/cache";

const DEFAULT_CRON_STORES = [
  "multimax",
  "panafoto",
  "rodelag",
  "titan",
  "photura",
  "doitcenter",
  "yoytec",
  "ptytec",
  "evisionstore",
  "raenco",
  "pntpanama",
  "samsungpa",
  "lgshoppa",
  "sonypa",
];

function parseStoresEnv(): string[] {
  const raw = process.env.CRON_STORES?.trim();
  if (!raw) return DEFAULT_CRON_STORES;
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_CRON_STORES;
}

/**
 * Limpieza segura de enlaces muertos / productos retirados por la tienda.
 * Solo actúa sobre tiendas cuyo scrape actual completó sano (sin `healthWarning`
 * y con items guardados), evitando borrar catálogo si una tienda tuvo un bloqueo temporal:
 *   1) > 3 días sin aparecer en una tienda sana  -> marca `in_stock = false`
 *   2) > 9 días (~3 ciclos) sin aparecer         -> elimina el `store_listing` obsoleto
 *   3) Elimina productos huérfanos sin listings (protegiendo favoritos y alertas)
 */
async function pruneStaleListingsForHealthyStores(
  runs: ScrapeRunSummary[]
): Promise<{
  healthyStores: number;
  markedOutOfStock: number;
  deletedListings: number;
  deletedOrphanProducts: number;
}> {
  const healthySlugs = runs
    .filter((r) => r.status === "completed" && !r.healthWarning && r.itemsUpserted > 0)
    .map((r) => r.storeSlug);

  if (healthySlugs.length === 0) {
    return {
      healthyStores: 0,
      markedOutOfStock: 0,
      deletedListings: 0,
      deletedOrphanProducts: 0,
    };
  }

  const storeRows = await db
    .select({ id: stores.id })
    .from(stores)
    .where(inArray(stores.slug, healthySlugs));

  const healthyStoreIds = storeRows.map((s) => s.id);
  if (healthyStoreIds.length === 0) {
    return {
      healthyStores: 0,
      markedOutOfStock: 0,
      deletedListings: 0,
      deletedOrphanProducts: 0,
    };
  }

  const storeIdList = sql.join(
    healthyStoreIds.map((id) => sql`${id}::uuid`),
    sql`, `
  );

  // 1) Marcar como agotados los listings no vistos en los últimos 3 días
  const oosRes = await db.execute(sql`
    UPDATE store_listings
    SET in_stock = false, updated_at = NOW()
    WHERE store_id IN (${storeIdList})
      AND in_stock = true
      AND last_scraped_at < NOW() - INTERVAL '3 days'
  `);
  const markedOutOfStock = Number((oosRes as unknown as { count?: number }).count ?? 0);

  // 2) Eliminar listings desaparecidos hace más de 9 días (enlaces 404 / retirados)
  const delListingsRes = await db.execute(sql`
    DELETE FROM store_listings
    WHERE store_id IN (${storeIdList})
      AND last_scraped_at < NOW() - INTERVAL '9 days'
  `);
  const deletedListings = Number((delListingsRes as unknown as { count?: number }).count ?? 0);

  // 3) Limpiar productos huérfanos sin listings (preservando favoritos y alertas)
  const delOrphansRes = await db.execute(sql`
    DELETE FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM store_listings sl WHERE sl.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM user_favorites f WHERE f.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM price_alerts a WHERE a.product_id = p.id)
  `);
  const deletedOrphanProducts = Number(
    (delOrphansRes as unknown as { count?: number }).count ?? 0
  );

  if (markedOutOfStock > 0 || deletedListings > 0 || deletedOrphanProducts > 0) {
    await refreshProductAggregates();
  }

  return {
    healthyStores: healthyStoreIds.length,
    markedOutOfStock,
    deletedListings,
    deletedOrphanProducts,
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      let dbStatus = "connected";
      try {
        await db.execute(sql`select 1`);
      } catch {
        dbStatus = "disconnected";
      }
      return Response.json({
        ok: true,
        service: "regateo-cron-function",
        db: dbStatus,
        firecrawlConfigured: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
        maxPerStore: Number(process.env.CRON_MAX_PER_STORE ?? 3000),
        branch: process.env.NEON_BRANCH ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "method_not_allowed", message: "Use POST for Neon schedule triggers." },
        { status: 405, headers: { Allow: "GET, POST" } }
      );
    }

    const parsed = await parseTriggerDelivery(request);
    if (!parsed.ok) {
      const status = parsed.error === "invalid_body" ? 400 : 401;
      return Response.json(
        { ok: false, error: parsed.error },
        { status }
      );
    }

    const invocation = parsed.invocation;
    if (invocation.type !== "schedule") {
      return Response.json(
        { ok: false, error: "unsupported_trigger_type", type: invocation.type },
        { status: 400 }
      );
    }

    const targetStores = parseStoresEnv();
    const maxPerStore = Math.min(
      5000,
      Math.max(10, Number(process.env.CRON_MAX_PER_STORE ?? 3000))
    );
    const useFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY?.trim());

    const startedAt = Date.now();
    const runs = await runScrapePipeline({
      stores: targetStores,
      maxPerStore,
      useFirecrawl,
      concurrency: 2,
    });

    const cleanup = await pruneStaleListingsForHealthyStores(runs);
    const alerts = await evaluateAndDispatchPriceAlerts();

    // Invalidar caché en Upstash Redis para que la web refleje precios y limpieza al instante
    await Promise.all([
      cacheInvalidatePrefix("products:"),
      cacheInvalidatePrefix("catalog:"),
      cacheInvalidatePrefix("seo:"),
    ]);

    const summary = runs.map((run) => ({
      storeSlug: run.storeSlug,
      status: run.status,
      itemsFound: run.itemsFound,
      itemsUpserted: run.itemsUpserted,
      healthWarning: run.healthWarning ?? null,
      errorMessage: run.errorMessage ?? null,
    }));

    return Response.json({
      ok: true,
      invocationId: invocation.invocationId,
      triggerName: invocation.trigger.name,
      scheduledAt: invocation.data.scheduledAt,
      durationMs: Date.now() - startedAt,
      useFirecrawl,
      maxPerStore,
      storesProcessed: summary.length,
      totalUpserted: summary.reduce((acc, r) => acc + r.itemsUpserted, 0),
      cleanup,
      alertsEvaluated: alerts,
      runs: summary,
    });
  },
};
