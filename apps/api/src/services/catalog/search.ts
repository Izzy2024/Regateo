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
  inArray,
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
  analyzeSearchQuery,
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
  type SearchMetaDTO,
  type SqlCondition,
  type StatsColumnSet,
} from "./shared";
import { findSimilarProducts } from "./similar";
import { computePriceInsight } from "./insights";

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

  const searchPlan = query.q ? analyzeSearchQuery(query.q) : null;

  // Builder común: la vía agregada añade el innerJoin; la materializada usa
  // solo `products` (sorts/filtros sobre columnas indexadas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseQuery = (selectShape?: any): any => {
    const qb = db.select(selectShape ?? summarySelect(stats)).from(products);
    return agg ? qb.innerJoin(agg, eq(agg.productId, products.id)) : qb;
  };

  // Helper de filtros rápidos cuando ya prefiltramos por `matchedBaseIds`
  const buildFacetedWhere = (
    matchedBaseIds: string[] | null,
    override: Partial<ProductSearchQuery>,
    usedFuzzy: boolean
  ) => {
    if (matchedBaseIds !== null) {
      const fastConds = buildConditions(
        {
          ...query,
          ...override,
          // `q`, precio, stock y multiStore ya fueron evaluados en el escaneo único
          q: undefined,
          minPrice: undefined,
          maxPrice: undefined,
          inStockOnly: undefined,
          multiStoreOnly: undefined,
        },
        stats
      );
      return and(
        inArray(products.id, matchedBaseIds) as SqlCondition,
        ...fastConds
      );
    }
    const conds = buildConditions(
      { ...query, ...override },
      stats,
      searchPlan,
      { fuzzy: usedFuzzy }
    );
    return conds.length > 0 ? and(...conds) : undefined;
  };

  let matchedBaseIds: string[] | null = null;
  let usedFuzzy = false;

  // Cuando hay búsqueda textual (`q`), evaluamos el predicado textual (regex/unaccent/EXISTS)
  // UNA sola vez para obtener los IDs candidatos base (sin category/brand/store), y reutilizamos
  // esos IDs indexados por PK en pageRows, total, comparableCount y las 3 facetas (~6x más rápido).
  if (query.q && searchPlan) {
    const baseQueryNoFacets: ProductSearchQuery = {
      ...query,
      category: undefined,
      brand: undefined,
      store: undefined,
    };
    const strictBaseConds = buildConditions(baseQueryNoFacets, stats, searchPlan);
    const strictBaseWhere =
      strictBaseConds.length > 0 ? and(...strictBaseConds) : undefined;

    const strictIdRows: Array<{ id: string }> = await baseQuery({
      id: products.id,
    }).where(strictBaseWhere);
    let candidateIds = strictIdRows.map((row) => row.id);

    // Fallback fuzzy pg_trgm: solo si no es SKU/código, hay tokens largos y
    // la búsqueda estricta trajo 0 (o < 3 con token largo sin concepto).
    if (
      !searchPlan.isCodeOrSku &&
      searchPlan.fuzzyTokens.length > 0 &&
      (candidateIds.length === 0 ||
        (candidateIds.length < 3 && searchPlan.hasUnmappedLongToken))
    ) {
      const fuzzyBaseConds = buildConditions(baseQueryNoFacets, stats, searchPlan, {
        fuzzy: true,
      });
      const fuzzyBaseWhere =
        fuzzyBaseConds.length > 0 ? and(...fuzzyBaseConds) : undefined;
      const fuzzyIdRows: Array<{ id: string }> = await baseQuery({
        id: products.id,
      }).where(fuzzyBaseWhere);
      if (fuzzyIdRows.length > candidateIds.length) {
        candidateIds = fuzzyIdRows.map((row) => row.id);
        usedFuzzy = true;
      }
    }

    // Sin coincidencias tras estricto + fuzzy: retorno inmediato sin consultas extra
    if (candidateIds.length === 0) {
      trackSearchEvent(query.q, query.category ?? null, 0);
      return {
        items: [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 0,
          totalPages: 1,
        },
        facets: { categories: [], brands: [], stores: [] },
        comparableCount: 0,
        searchMeta: {
          normalizedQuery: searchPlan.normalizedQuery,
          matchedVia: usedFuzzy ? "fuzzy" : searchPlan.matchedVia,
          expandedTerms: searchPlan.expandedTerms,
        },
      };
    }

    // Para conjuntos acotados (<= 3000 IDs, 99.9% de búsquedas) usamos PK index
    if (candidateIds.length <= 3000) {
      matchedBaseIds = candidateIds;
    }
  }

  const activeWhere = buildFacetedWhere(matchedBaseIds, {}, usedFuzzy);
  const categoryFacetWhere = buildFacetedWhere(
    matchedBaseIds,
    { category: undefined },
    usedFuzzy
  );
  const brandFacetWhere = buildFacetedWhere(
    matchedBaseIds,
    { brand: undefined },
    usedFuzzy
  );
  const storeFacetWhere = buildFacetedWhere(
    matchedBaseIds,
    { store: undefined },
    usedFuzzy
  );

  // comparableCount exacto: productos con 2+ tiendas DISTINTAS en stock
  const comparableAgg = db
    .select({ productId: storeListings.productId })
    .from(storeListings)
    .where(
      matchedBaseIds !== null
        ? and(
            eq(storeListings.inStock, true),
            inArray(storeListings.productId, matchedBaseIds)
          )
        : eq(storeListings.inStock, true)
    )
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

  const [pageRows, totalRows, comparableRows, categoryRows, brandRows, storeRows]: [
    ProductRowLite[],
    Array<{ total: number }>,
    Array<{ comparable: number }>,
    Array<{ key: string; count: number }>,
    Array<{ name: string | null; count: number }>,
    Array<{ slug: string; name: string; count: number }>,
  ] = await Promise.all([
    baseQuery()
      .where(activeWhere)
      .orderBy(
        ...buildOrderBy(stats, query.sort, query.q, searchPlan, {
          fuzzy: usedFuzzy,
        })
      )
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    baseQuery({ total: sql<number>`count(*)::int` }).where(activeWhere),
    comparableFinalQb.where(activeWhere),
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

  const total = totalRows[0]?.total ?? 0;
  const comparableCount = comparableRows[0]?.comparable ?? 0;

  const listingRows = await fetchListingRows(pageRows.map((row) => row.id));
  const items = pageRows.map((row) =>
    buildSummaryDTO(row, buildListingDTOs(listingRows.get(row.id) ?? []))
  );

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

  const searchMeta: SearchMetaDTO | undefined = searchPlan
    ? {
        normalizedQuery: searchPlan.normalizedQuery,
        matchedVia: usedFuzzy ? "fuzzy" : searchPlan.matchedVia,
        expandedTerms: searchPlan.expandedTerms,
      }
    : undefined;

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
    searchMeta,
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
  const priceHistoryPoints: PriceHistoryPointDTO[] = [...seen.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, storeSlug, storeName, storeColor, priceCents }) => ({
      date,
      storeSlug,
      storeName,
      storeColor,
      priceCents,
    }));

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

  // "Verdad del precio": historial real + detector de descuentos falsos +
  // veredicto ¿compro ahora o espero?
  const priceInsight = computePriceInsight(
    {
      bestPriceCents: detailRow.bestPriceCents,
      highestPriceCents: detailRow.highestPriceCents,
      savingsCents: detailRow.savingsCents,
    },
    listingDTOs,
    priceHistoryPoints
  );

  return {
    ...summary,
    specs: row.specs ?? null,
    similarProducts,
    priceHistory: priceHistoryPoints,
    priceInsight,
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
