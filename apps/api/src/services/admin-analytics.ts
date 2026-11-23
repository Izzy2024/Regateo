// ============================================================================
// Analítica interna de negocio (Fase 3): clicks de salida, búsquedas,
// reportes de precios y cobertura multi-tienda. Protegido por CRON_SECRET.
// ============================================================================
import {
  db,
  and,
  desc,
  eq,
  gte,
  inArray,
  sql,
  outboundClicks,
  priceReports,
  products,
  searchEvents,
  storeRequests,
  stores,
} from "@regateo/db";
import type { AnalyticsSummaryDTO } from "@regateo/shared";

export async function getAnalyticsSummary(
  days: number
): Promise<AnalyticsSummaryDTO> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    clicksTotalRows,
    clicksByStoreRows,
    topClickedRows,
    topSearchRows,
    zeroResultRows,
    openReportsRows,
    openStoreRequestsRows,
    topStoreRequestsRows,
    productRows,
  ] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(outboundClicks)
      .where(gte(outboundClicks.createdAt, since)),

    db
      .select({
        storeSlug: stores.slug,
        storeName: stores.name,
        clicks: sql<number>`count(*)::int`,
      })
      .from(outboundClicks)
      .innerJoin(stores, eq(stores.id, outboundClicks.storeId))
      .where(gte(outboundClicks.createdAt, since))
      .groupBy(stores.slug, stores.name)
      .orderBy(desc(sql`count(*)`)),

    db
      .select({
        productId: outboundClicks.productId,
        slug: products.slug,
        canonicalName: products.canonicalName,
        clicks: sql<number>`count(*)::int`,
      })
      .from(outboundClicks)
      .innerJoin(products, eq(products.id, outboundClicks.productId))
      .where(gte(outboundClicks.createdAt, since))
      .groupBy(outboundClicks.productId, products.slug, products.canonicalName)
      .orderBy(desc(sql`count(*)`))
      .limit(10),

    db
      .select({
        query: searchEvents.query,
        count: sql<number>`count(*)::int`,
        avgResults: sql<number>`round(avg(${searchEvents.resultsCount})::numeric, 1)::float8`,
      })
      .from(searchEvents)
      .where(gte(searchEvents.createdAt, since))
      .groupBy(searchEvents.query)
      .orderBy(desc(sql`count(*)`))
      .limit(15),

    db
      .select({
        query: searchEvents.query,
        count: sql<number>`count(*)::int`,
      })
      .from(searchEvents)
      .where(and(gte(searchEvents.createdAt, since), eq(searchEvents.resultsCount, 0)))
      .groupBy(searchEvents.query)
      .orderBy(desc(sql`count(*)`))
      .limit(15),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(priceReports)
      .where(and(eq(priceReports.status, "open"), gte(priceReports.createdAt, since))),

    // Sugerencias de tiendas pendientes de evaluar (todo el histórico: una
    // sugerencia abierta no "caduca" con el período consultado).
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(storeRequests)
      .where(inArray(storeRequests.status, ["pending", "reviewing"])),

    db
      .select({
        storeName: storeRequests.storeName,
        websiteUrl: storeRequests.websiteUrl,
        votes: storeRequests.votes,
        status: storeRequests.status,
      })
      .from(storeRequests)
      .orderBy(desc(storeRequests.votes))
      .limit(10),

    db
      .select({
        total: sql<number>`count(*)::int`,
        multiStore: sql<number>`(count(*) filter (where ${products.storeCount} >= 2))::int`,
      })
      .from(products),
  ]);

  const productStats = productRows[0] ?? { total: 0, multiStore: 0 };
  const totalProducts = productStats.total;
  const multiStoreProducts = productStats.multiStore;

  return {
    periodDays: days,
    outboundClicksTotal: clicksTotalRows[0]?.total ?? 0,
    outboundClicksByStore: clicksByStoreRows.map((row) => ({
      storeSlug: row.storeSlug,
      storeName: row.storeName,
      clicks: row.clicks,
    })),
    topClickedProducts: topClickedRows.map((row) => ({
      productId: row.productId,
      slug: row.slug,
      canonicalName: row.canonicalName,
      clicks: row.clicks,
    })),
    topSearches: topSearchRows.map((row) => ({
      query: row.query,
      count: row.count,
      avgResults: Number(row.avgResults ?? 0),
    })),
    zeroResultSearches: zeroResultRows.map((row) => ({
      query: row.query,
      count: row.count,
    })),
    openPriceReportsCount: openReportsRows[0]?.total ?? 0,
    openStoreRequestsCount: openStoreRequestsRows[0]?.total ?? 0,
    topStoreRequests: topStoreRequestsRows.map((row) => ({
      storeName: row.storeName,
      websiteUrl: row.websiteUrl,
      votes: row.votes,
      status: row.status,
    })),
    totalProducts,
    multiStoreProducts,
    multiStoreCoveragePct:
      totalProducts > 0
        ? Math.round((multiStoreProducts / totalProducts) * 10000) / 100
        : 0,
  };
}
