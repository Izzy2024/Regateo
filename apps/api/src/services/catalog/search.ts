// ============================================================================
// Consultas de búsqueda/lectura del catálogo. Estrategia de stats dual:
//   • Vía rápida: columnas materializadas de `products` (indexadas) cuando
//     TODOS los productos están materializados.
//   • Vía agregada: subquery en vivo sobre `store_listings` mientras algún
//     producto tenga `best_price_cents IS NULL` (fallback limpio).
// ============================================================================
import {
  db,
  and,
  asc,
  desc,
  eq,
  sql,
  products,
  storeListings,
  stores,
  priceHistory,
  scrapeRuns,
} from "@regateo/db";
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
  type ProductDetailDTO,
  type ProductSearchQuery,
  type ProductSummaryDTO,
  type PriceHistoryPointDTO,
  type StorePlatform,
  type StoreStatusDTO,
} from "@regateo/shared";
import {
  aggStats,
  buildConditions,
  buildListingDTOs,
  buildOrderBy,
  buildSummaryDTO,
  fetchListingRows,
  isMaterializedReady,
  listingStatsSubquery,
  materializedStats,
  statsForProducts,
  summarySelect,
  toIso,
  trackSearchEvent,
  type CatalogFacets,
  type CatalogSearchResult,
  type ListingStats,
  type ProductRowLite,
  type ScrapeRunDTO,
  type SqlCondition,
  type StatsColumnSet,
} from "./shared";
import { findSimilarProducts } from "./similar";

// ---------------------------------------------------------------------------
// Búsqueda con facetas independientes, unaccent, relevancia pg_trgm y
// meta.comparableCount
// ---------------------------------------------------------------------------
export async function searchProducts(
  query: ProductSearchQuery
): Promise<CatalogSearchResult> {
  const materialized = await isMaterializedReady();
  const agg: ListingStats | null = materialized ? null : listingStatsSubquery();
  const stats: StatsColumnSet = agg ? aggStats(agg) : materializedStats();

  const conditions = buildConditions(query, stats);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Builder común: la vía agregada añade el innerJoin; la materializada usa
  // solo `products` (sorts/filtros sobre columnas indexadas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseQuery = (selectShape?: any): any => {
    const qb = db.select(selectShape ?? summarySelect(stats)).from(products);
    return agg ? qb.innerJoin(agg, eq(agg.productId, products.id)) : qb;
  };

  const pageRows: ProductRowLite[] = await baseQuery()
    .where(where)
    .orderBy(...buildOrderBy(stats, query.sort, query.q))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);

  // comparableCount exacto: productos con 2+ tiendas DISTINTAS en stock
  const comparableAgg = db
    .select({ productId: storeListings.productId })
    .from(storeListings)
    .where(eq(storeListings.inStock, true))
    .groupBy(storeListings.productId)
    .having(sql`count(distinct ${storeListings.storeId}) >= 2`)
    .as("comparable_stats");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comparableQb: any = db
    .select({ comparable: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(comparableAgg, eq(comparableAgg.productId, products.id));
  const comparableFinalQb = agg
    ? comparableQb.innerJoin(agg, eq(agg.productId, products.id))
    : comparableQb;

  const [totalRows, comparableRows] = await Promise.all([
    baseQuery({ total: sql<number>`count(*)::int` }).where(where),
    comparableFinalQb.where(where),
  ]);

  const total = totalRows[0]?.total ?? 0;
  const comparableCount = comparableRows[0]?.comparable ?? 0;

  const listingRows = await fetchListingRows(pageRows.map((row) => row.id));
  const items = pageRows.map((row) =>
    buildSummaryDTO(row, buildListingDTOs(listingRows.get(row.id) ?? []))
  );

  // Facetas INDEPENDIENTES: al contar categorías se excluye el filtro
  // category; al contar marcas se excluye brand; al contar tiendas se excluye
  // store. Así las facetas nunca "desaparecen" al seleccionar un filtro.
  const categoryFacetWhere = and(
    ...buildConditions({ ...query, category: undefined }, stats)
  );
  const brandFacetWhere = and(...buildConditions({ ...query, brand: undefined }, stats));
  const storeFacetWhere = and(...buildConditions({ ...query, store: undefined }, stats));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeFacetQb: any = db
    .select({
      slug: stores.slug,
      name: stores.name,
      count: sql<number>`count(distinct ${products.id})::int`,
    })
    .from(products)
    .innerJoin(storeListings, eq(storeListings.productId, products.id))
    .innerJoin(stores, eq(stores.id, storeListings.storeId));
  const storeFacetFinalQb = agg
    ? storeFacetQb.innerJoin(agg, eq(agg.productId, products.id))
    : storeFacetQb;

  const [categoryRows, brandRows, storeRows] = await Promise.all([
    baseQuery({ key: products.category, count: sql<number>`count(*)::int` })
      .where(categoryFacetWhere)
      .groupBy(products.category)
      .orderBy(desc(sql`count(*)`)),
    baseQuery({ name: products.brand, count: sql<number>`count(*)::int` })
      .where(brandFacetWhere)
      .groupBy(products.brand)
      .orderBy(desc(sql`count(*)`))
      .limit(40),
    storeFacetFinalQb
      .where(storeFacetWhere)
      .groupBy(stores.slug, stores.name)
      .orderBy(desc(sql`count(distinct ${products.id})`)),
  ]);

  const facets: CatalogFacets = {
    categories: categoryRows
      .filter((row: any) => PRODUCT_CATEGORIES.includes(row.key as ProductCategory))
      .map((row: any) => ({ key: row.key as ProductCategory, count: row.count })),
    brands: brandRows
      .filter((row: any): row is { name: string; count: number } => row.name !== null)
      .map((row: { name: string; count: number }) => ({
        name: row.name,
        count: row.count,
      })),
    stores: storeRows.map((row: any) => ({
      slug: row.slug,
      name: row.name,
      count: row.count,
    })),
  };

  trackSearchEvent(query.q ?? "", query.category ?? null, total);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
    facets,
    comparableCount,
  };
}

// ---------------------------------------------------------------------------
// Deals: mayor ahorro real entre tiendas con stock
// ---------------------------------------------------------------------------
export async function getBestDeals(limit = 24): Promise<ProductSummaryDTO[]> {
  const materialized = await isMaterializedReady();
  const agg: ListingStats | null = materialized ? null : listingStatsSubquery();
  const stats = agg ? aggStats(agg) : materializedStats();

  const qb: any = agg
    ? db
        .select(summarySelect(stats))
        .from(products)
        .innerJoin(agg, eq(agg.productId, products.id))
    : db.select(summarySelect(stats)).from(products);

  const pageRows: ProductRowLite[] = await qb
    .where(sql`${stats.savingsCents} > 0`)
    .orderBy(
      desc(stats.savingsCents) as SqlCondition,
      desc(stats.storeCount) as SqlCondition
    )
    .limit(limit);

  const listingRows = await fetchListingRows(pageRows.map((row) => row.id));
  return pageRows.map((row) =>
    buildSummaryDTO(row, buildListingDTOs(listingRows.get(row.id) ?? []))
  );
}

// ---------------------------------------------------------------------------
// Detalle de producto por slug (materializado + fallback por fila)
// ---------------------------------------------------------------------------
export async function getProductBySlug(
  slug: string
): Promise<ProductDetailDTO | null> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      canonicalName: products.canonicalName,
      brand: products.brand,
      modelNumber: products.modelNumber,
      category: products.category,
      imageUrl: products.imageUrl,
      specs: products.specs,
      updatedAt: products.updatedAt,
      bestPriceCents: products.bestPriceCents,
      highestPriceCents: products.highestPriceCents,
      savingsCents: products.savingsCents,
      storeCount: products.storeCount,
      inStockCount: products.inStockCount,
    })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Fallback por fila: producto aún no materializado → agregado en vivo
  if (row.bestPriceCents === null) {
    const statsFallback = await statsForProducts([row.id]);
    const fallbackRow = statsFallback.get(row.id);
    if (fallbackRow) {
      row.bestPriceCents = fallbackRow.bestPriceCents;
      row.highestPriceCents = fallbackRow.highestPriceCents;
      row.savingsCents = fallbackRow.savingsCents;
      row.storeCount = fallbackRow.storeCount;
      row.inStockCount = fallbackRow.inStockCount;
    } else {
      return null; // sin listings activos
    }
  }
  const detailRow = row as ProductRowLite;

  const listingRows = await fetchListingRows([row.id]);
  const listingDTOs = buildListingDTOs(listingRows.get(row.id) ?? []);

  const historyRows = await db
    .select({
      date: sql<string>`to_char(${priceHistory.recordedAt}, 'YYYY-MM-DD')`,
      recordedAt: priceHistory.recordedAt,
      priceCents: priceHistory.priceCents,
      storeSlug: stores.slug,
      storeName: stores.name,
      storeColor: stores.color,
    })
    .from(priceHistory)
    .innerJoin(storeListings, eq(storeListings.id, priceHistory.listingId))
    .innerJoin(stores, eq(stores.id, storeListings.storeId))
    .where(eq(storeListings.productId, row.id))
    .orderBy(asc(priceHistory.recordedAt));

  // Agrupar por (fecha, tienda) conservando el último precio del día.
  const seen = new Map<string, PriceHistoryPointDTO & { recordedAt: Date | string }>();
  for (const historyRow of historyRows) {
    const key = `${historyRow.date}::${historyRow.storeSlug}`;
    const existing = seen.get(key);
    if (
      existing &&
      new Date(existing.recordedAt as string | Date).getTime() >=
        new Date(historyRow.recordedAt).getTime()
    ) {
      continue;
    }
    seen.set(key, {
      date: historyRow.date,
      storeSlug: historyRow.storeSlug,
      storeName: historyRow.storeName,
      storeColor: historyRow.storeColor,
      priceCents: historyRow.priceCents,
      recordedAt: historyRow.recordedAt,
    });
  }

  const summary = buildSummaryDTO(detailRow, listingDTOs);
  const similarProducts = await findSimilarProducts(
    {
      id: detailRow.id,
      slug: detailRow.slug,
      canonicalName: detailRow.canonicalName,
      brand: detailRow.brand,
      modelNumber: detailRow.modelNumber,
      category: detailRow.category as ProductCategory,
      bestPriceCents: detailRow.bestPriceCents,
      specs: row.specs ?? null,
    },
    listingDTOs.map((listing) => listing.storeSlug),
    8
  );
  return {
    ...summary,
    specs: row.specs ?? null,
    similarProducts,
    priceHistory: [...seen.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ date, storeSlug, storeName, storeColor, priceCents }) => ({
        date,
        storeSlug,
        storeName,
        storeColor,
        priceCents,
      })),
  };
}

// ---------------------------------------------------------------------------
// Tiendas: estado + runs recientes
// ---------------------------------------------------------------------------
export async function getStoresStatus(): Promise<{
  stores: StoreStatusDTO[];
  recentRuns: ScrapeRunDTO[];
}> {
  const storeRows = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      baseUrl: stores.baseUrl,
      platform: stores.platform,
      color: stores.color,
      accentBg: stores.accentBg,
      enabled: stores.enabled,
      lastScrapedAt: stores.lastScrapedAt,
      listingCount: sql<number>`count(${storeListings.id})::int`,
    })
    .from(stores)
    .leftJoin(storeListings, eq(storeListings.storeId, stores.id))
    .groupBy(
      stores.id,
      stores.slug,
      stores.name,
      stores.baseUrl,
      stores.platform,
      stores.color,
      stores.accentBg,
      stores.enabled,
      stores.lastScrapedAt
    )
    .orderBy(asc(stores.name));

  const runRows = await db
    .select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(30);

  const lastRunBySlug = new Map<string, ScrapeRunDTO>();
  const recentRuns: ScrapeRunDTO[] = runRows.map((run) => {
    const dto: ScrapeRunDTO = {
      id: run.id,
      storeSlug: run.storeSlug,
      engine: run.engine,
      status: run.status,
      itemsFound: run.itemsFound,
      itemsUpserted: run.itemsUpserted,
      errorMessage: run.errorMessage ?? null,
      startedAt: toIso(run.startedAt) ?? new Date().toISOString(),
      finishedAt: toIso(run.finishedAt),
    };
    if (!lastRunBySlug.has(run.storeSlug)) lastRunBySlug.set(run.storeSlug, dto);
    return dto;
  });

  const storeStatuses: StoreStatusDTO[] = storeRows.map((row) => {
    const lastRun = lastRunBySlug.get(row.slug) ?? null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      baseUrl: row.baseUrl,
      platform: row.platform as StorePlatform,
      color: row.color,
      accentBg: row.accentBg,
      enabled: row.enabled,
      listingCount: row.listingCount,
      lastScrapedAt: toIso(row.lastScrapedAt),
      lastRunStatus: lastRun?.status ?? null,
      lastRunItems: lastRun?.itemsUpserted ?? 0,
    };
  });

  return { stores: storeStatuses, recentRuns };
}

/** Fecha del último scraping exitoso (para meta.lastScrapedAt). */
export async function getLastScrapedAt(): Promise<string | null> {
  const [storeMax] = await db
    .select({ latest: sql<string | null>`max(${stores.lastScrapedAt})` })
    .from(stores);
  const [runMax] = await db
    .select({ latest: sql<string | null>`max(${scrapeRuns.startedAt})` })
    .from(scrapeRuns)
    .where(eq(scrapeRuns.status, "completed"));

  const candidates = [toIso(storeMax?.latest), toIso(runMax?.latest)].filter(
    (value): value is string => value !== null
  );
  if (candidates.length === 0) return null;
  return candidates.sort().at(-1) ?? null;
}
