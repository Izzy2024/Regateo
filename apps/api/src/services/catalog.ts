// ============================================================================
// Servicio de catálogo — consultas Drizzle sobre products / store_listings /
// stores / price_history / scrape_runs, con agregados SQL para best price,
// savings, facets y ordenamiento. Produce los DTOs exactos de @regateo/shared.
// ============================================================================
import {
  db,
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  products,
  storeListings,
  stores,
  priceHistory,
  scrapeRuns,
  priceAlerts,
} from "@regateo/db";
import {
  PRODUCT_CATEGORIES,
  formatUsdFromCents,
  type CreatePriceAlertInput,
  type ProductCategory,
  type ProductDetailDTO,
  type ProductSearchQuery,
  type ProductSummaryDTO,
  type PriceHistoryPointDTO,
  type SimilarProductDTO,
  type StoreListingDTO,
  type StorePlatform,
  type StoreStatusDTO,
} from "@regateo/shared";

// ---------------------------------------------------------------------------
// Tipos públicos del servicio
// ---------------------------------------------------------------------------
export interface CatalogFacets {
  categories: { key: ProductCategory; count: number }[];
  brands: { name: string; count: number }[];
  stores: { slug: string; name: string; count: number }[];
}

export interface CatalogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CatalogSearchResult {
  items: ProductSummaryDTO[];
  pagination: CatalogPagination;
  facets: CatalogFacets;
}

export interface ScrapeRunDTO {
  id: string;
  storeSlug: string;
  engine: string;
  status: string;
  itemsFound: number;
  itemsUpserted: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AlertDTO {
  id: string;
  email: string;
  targetPriceCents: number;
  active: boolean;
  createdAt: string;
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    imageUrl: string | null;
    currentBestPriceCents: number | null;
  };
}

type SqlCondition = ReturnType<typeof eq>;

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Subquery agregada de listings por producto (best/highest price, stores...)
// ---------------------------------------------------------------------------
function listingStatsSubquery() {
  return db
    .select({
      productId: storeListings.productId,
      bestPriceCents: sql<number>`min(${storeListings.priceCents})::int`.as("best_price_cents"),
      highestPriceCents: sql<number>`max(${storeListings.priceCents})::int`.as("highest_price_cents"),
      maxOriginalPriceCents: sql<
        number | null
      >`max(${storeListings.originalPriceCents})::int`.as("max_original_price_cents"),
      storeCount: sql<number>`count(distinct ${storeListings.storeId})::int`.as("store_count"),
      inStockCount:
        sql<number>`(count(*) filter (where ${storeListings.inStock}))::int`.as("in_stock_count"),
    })
    .from(storeListings)
    .groupBy(storeListings.productId)
    .as("listing_stats");
}

type ListingStats = ReturnType<typeof listingStatsSubquery>;

/** Ahorro real: mayor spread entre tiendas o descuento sobre precio original. */
function savingsExpr(agg: ListingStats) {
  return sql<number>`greatest(${agg.highestPriceCents} - ${agg.bestPriceCents}, coalesce(${agg.maxOriginalPriceCents}, 0) - ${agg.bestPriceCents}, 0)::int`;
}

function buildConditions(query: ProductSearchQuery, agg: ListingStats): SqlCondition[] {
  const conditions: SqlCondition[] = [];

  if (query.q) {
    // Búsqueda multi-token (AND): cada término significativo debe aparecer en
    // nombre, marca, modelo, slug — o en el título/external_id de un listing
    // (Ej: "155144" encuentra el producto por SKU de tienda).
    const tokens = query.q
      .toLowerCase()
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 4);
    const effectiveTokens = tokens.length > 0 ? tokens : [query.q];
    for (const token of effectiveTokens) {
      const like = `%${token}%`;
      conditions.push(
        or(
          ilike(products.canonicalName, like),
          ilike(products.brand, like),
          ilike(products.modelNumber, like),
          ilike(products.slug, like),
          sql`exists (select 1 from ${storeListings} sl where sl.product_id = ${products.id} and (sl.title_at_store ilike ${like} or sl.external_id ilike ${like}))`
        ) as SqlCondition
      );
    }
  }
  if (query.category) {
    conditions.push(eq(products.category, query.category) as SqlCondition);
  }
  if (query.brand) {
    conditions.push(ilike(products.brand, `%${query.brand}%`) as SqlCondition);
  }
  if (query.store) {
    const storeProductIds = db
      .select({ pid: storeListings.productId })
      .from(storeListings)
      .innerJoin(stores, eq(stores.id, storeListings.storeId))
      .where(ilike(stores.slug, query.store));
    conditions.push(inArray(products.id, storeProductIds) as SqlCondition);
  }
  if (query.minPrice !== undefined && query.minPrice !== null) {
    conditions.push(
      gte(agg.bestPriceCents, Math.round(query.minPrice * 100)) as SqlCondition
    );
  }
  if (query.maxPrice !== undefined && query.maxPrice !== null) {
    conditions.push(
      lte(agg.bestPriceCents, Math.round(query.maxPrice * 100)) as SqlCondition
    );
  }
  if (query.inStockOnly) {
    conditions.push(sql`${agg.inStockCount} > 0` as SqlCondition);
  }
  if (query.multiStoreOnly) {
    conditions.push(sql`${agg.storeCount} >= 2` as SqlCondition);
  }
  return conditions;
}

function buildOrderBy(
  agg: ListingStats,
  sort: ProductSearchQuery["sort"]
): SqlCondition[] {
  switch (sort) {
    case "price-asc":
      return [asc(agg.bestPriceCents) as SqlCondition];
    case "price-desc":
      return [desc(agg.bestPriceCents) as SqlCondition];
    case "most-stores":
      return [
        desc(agg.storeCount) as SqlCondition,
        desc(savingsExpr(agg)) as SqlCondition,
      ];
    case "recent":
      return [desc(products.updatedAt) as SqlCondition];
    case "best-savings":
    default:
      return [
        desc(savingsExpr(agg)) as SqlCondition,
        desc(agg.storeCount) as SqlCondition,
      ];
  }
}

// ---------------------------------------------------------------------------
// Filas de listings con datos de tienda, para armar los DTOs
// ---------------------------------------------------------------------------
interface ListingRow {
  productId: string;
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  storeColor: string;
  storeAccentBg: string;
  titleAtStore: string;
  priceCents: number;
  originalPriceCents: number | null;
  currency: string;
  inStock: boolean;
  url: string;
  imageUrl: string | null;
  lastCheckedAt: Date | string;
}

async function fetchListingRows(productIds: string[]): Promise<Map<string, ListingRow[]>> {
  const grouped = new Map<string, ListingRow[]>();
  if (productIds.length === 0) return grouped;

  const rows: ListingRow[] = await db
    .select({
      productId: storeListings.productId,
      id: storeListings.id,
      storeId: storeListings.storeId,
      storeSlug: stores.slug,
      storeName: stores.name,
      storeColor: stores.color,
      storeAccentBg: stores.accentBg,
      titleAtStore: storeListings.titleAtStore,
      priceCents: storeListings.priceCents,
      originalPriceCents: storeListings.originalPriceCents,
      currency: storeListings.currency,
      inStock: storeListings.inStock,
      url: storeListings.url,
      imageUrl: storeListings.imageUrl,
      lastCheckedAt: storeListings.lastCheckedAt,
    })
    .from(storeListings)
    .innerJoin(stores, eq(stores.id, storeListings.storeId))
    .where(inArray(storeListings.productId, productIds))
    .orderBy(asc(storeListings.priceCents));

  for (const row of rows) {
    const bucket = grouped.get(row.productId);
    if (bucket) bucket.push(row);
    else grouped.set(row.productId, [row]);
  }
  return grouped;
}

function buildListingDTOs(rows: ListingRow[]): StoreListingDTO[] {
  const best = rows.length > 0 ? rows[0].priceCents : 0;
  return rows.map((row) => ({
    id: row.id,
    storeId: row.storeId,
    storeSlug: row.storeSlug,
    storeName: row.storeName,
    storeColor: row.storeColor,
    storeAccentBg: row.storeAccentBg,
    titleAtStore: row.titleAtStore,
    priceCents: row.priceCents,
    originalPriceCents: row.originalPriceCents ?? null,
    currency: row.currency,
    inStock: row.inStock,
    url: row.url,
    imageUrl: row.imageUrl ?? null,
    lastCheckedAt: toIso(row.lastCheckedAt) ?? new Date().toISOString(),
    isCheapest: row.priceCents === best,
    deltaFromCheapestCents: row.priceCents - best,
  }));
}

function roundSavingsPercent(savingsCents: number, highestCents: number): number {
  if (highestCents <= 0 || savingsCents <= 0) return 0;
  return Math.round((savingsCents / highestCents) * 10000) / 100;
}

interface ProductRowLite {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: string;
  imageUrl: string | null;
  updatedAt: Date | string;
}

function buildSummaryDTO(
  row: ProductRowLite & {
    bestPriceCents: number;
    highestPriceCents: number;
    savingsCents: number;
    storeCount: number;
    inStockCount: number;
  },
  listingDTOs: StoreListingDTO[]
): ProductSummaryDTO {
  const bestListing = listingDTOs[0] ?? null;
  return {
    id: row.id,
    slug: row.slug,
    canonicalName: row.canonicalName,
    brand: row.brand,
    modelNumber: row.modelNumber,
    category: row.category as ProductCategory,
    imageUrl: row.imageUrl ?? null,
    bestPriceCents: row.bestPriceCents,
    highestPriceCents: row.highestPriceCents,
    savingsCents: row.savingsCents,
    savingsPercent: roundSavingsPercent(row.savingsCents, row.highestPriceCents),
    storeCount: row.storeCount,
    inStockCount: row.inStockCount,
    bestStore: bestListing
      ? {
          slug: bestListing.storeSlug,
          name: bestListing.storeName,
          color: bestListing.storeColor,
          url: bestListing.url,
        }
      : null,
    listings: listingDTOs,
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}

const summarySelect = (agg: ListingStats) => ({
  id: products.id,
  slug: products.slug,
  canonicalName: products.canonicalName,
  brand: products.brand,
  modelNumber: products.modelNumber,
  category: products.category,
  imageUrl: products.imageUrl,
  updatedAt: products.updatedAt,
  bestPriceCents: agg.bestPriceCents,
  highestPriceCents: agg.highestPriceCents,
  savingsCents: savingsExpr(agg),
  storeCount: agg.storeCount,
  inStockCount: agg.inStockCount,
});

// ---------------------------------------------------------------------------
// Búsqueda de productos con facets y paginación
// ---------------------------------------------------------------------------
export async function searchProducts(
  query: ProductSearchQuery
): Promise<CatalogSearchResult> {
  const agg = listingStatsSubquery();
  const conditions = buildConditions(query, agg);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const pageRows = await db
    .select(summarySelect(agg))
    .from(products)
    .innerJoin(agg, eq(agg.productId, products.id))
    .where(where)
    .orderBy(...buildOrderBy(agg, query.sort))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(agg, eq(agg.productId, products.id))
    .where(where);

  const total = totalRow?.total ?? 0;

  const listingRows = await fetchListingRows(pageRows.map((row) => row.id));
  const items = pageRows.map((row) =>
    buildSummaryDTO(row, buildListingDTOs(listingRows.get(row.id) ?? []))
  );

  const [categoryRows, brandRows, storeRows] = await Promise.all([
    db
      .select({ key: products.category, count: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(agg, eq(agg.productId, products.id))
      .where(where)
      .groupBy(products.category)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ name: products.brand, count: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(agg, eq(agg.productId, products.id))
      .where(where)
      .groupBy(products.brand)
      .orderBy(desc(sql`count(*)`))
      .limit(40),
    db
      .select({
        slug: stores.slug,
        name: stores.name,
        count: sql<number>`count(distinct ${products.id})::int`,
      })
      .from(products)
      .innerJoin(agg, eq(agg.productId, products.id))
      .innerJoin(storeListings, eq(storeListings.productId, products.id))
      .innerJoin(stores, eq(stores.id, storeListings.storeId))
      .where(where)
      .groupBy(stores.slug, stores.name)
      .orderBy(desc(sql`count(distinct ${products.id})`)),
  ]);

  const facets: CatalogFacets = {
    categories: categoryRows
      .filter((row) => PRODUCT_CATEGORIES.includes(row.key as ProductCategory))
      .map((row) => ({ key: row.key as ProductCategory, count: row.count })),
    brands: brandRows
      .filter((row): row is { name: string; count: number } => row.name !== null)
      .map((row) => ({ name: row.name, count: row.count })),
    stores: storeRows.map((row) => ({
      slug: row.slug,
      name: row.name,
      count: row.count,
    })),
  };

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
    facets,
  };
}

// ---------------------------------------------------------------------------
// Deals: mayor ahorro real (entre tiendas o sobre precio original)
// ---------------------------------------------------------------------------
export async function getBestDeals(limit = 24): Promise<ProductSummaryDTO[]> {
  const agg = listingStatsSubquery();
  const where = sql`${savingsExpr(agg)} > 0`;

  const pageRows = await db
    .select(summarySelect(agg))
    .from(products)
    .innerJoin(agg, eq(agg.productId, products.id))
    .where(where)
    .orderBy(
      desc(savingsExpr(agg)) as SqlCondition,
      desc(agg.storeCount) as SqlCondition
    )
    .limit(limit);

  const listingRows = await fetchListingRows(pageRows.map((row) => row.id));
  return pageRows.map((row) =>
    buildSummaryDTO(row, buildListingDTOs(listingRows.get(row.id) ?? []))
  );
}

// ---------------------------------------------------------------------------
// Detalle de producto por slug (+ historial para Recharts)
// ---------------------------------------------------------------------------
export async function getProductBySlug(slug: string): Promise<ProductDetailDTO | null> {
  const agg = listingStatsSubquery();
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
      bestPriceCents: agg.bestPriceCents,
      highestPriceCents: agg.highestPriceCents,
      savingsCents: savingsExpr(agg),
      storeCount: agg.storeCount,
      inStockCount: agg.inStockCount,
    })
    .from(products)
    .innerJoin(agg, eq(agg.productId, products.id))
    .where(eq(products.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

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

  const summary = buildSummaryDTO(row, listingDTOs);
  const similarProducts = await findSimilarProducts(
    {
      id: row.id,
      slug: row.slug,
      canonicalName: row.canonicalName,
      brand: row.brand,
      modelNumber: row.modelNumber,
      category: row.category as ProductCategory,
      bestPriceCents: row.bestPriceCents,
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

  const candidates = [
    toIso(storeMax?.latest),
    toIso(runMax?.latest),
  ].filter((value): value is string => value !== null);
  if (candidates.length === 0) return null;
  return candidates.sort().at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Alertas de precio
// ---------------------------------------------------------------------------
export async function productExistsById(productId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return Boolean(row);
}

export async function createPriceAlert(
  input: CreatePriceAlertInput,
  userId?: string | null
): Promise<AlertDTO | null> {
  const [alert] = await db
    .insert(priceAlerts)
    .values({
      productId: input.productId,
      email: input.email,
      targetPriceCents: input.targetPriceCents,
      active: true,
      userId: userId ?? null,
    })
    .returning();

  if (!alert) return null;

  const [productRow] = await db
    .select({
      id: products.id,
      slug: products.slug,
      canonicalName: products.canonicalName,
      imageUrl: products.imageUrl,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);

  return {
    id: alert.id,
    email: alert.email,
    targetPriceCents: alert.targetPriceCents,
    active: alert.active,
    createdAt: toIso(alert.createdAt) ?? new Date().toISOString(),
    product: {
      id: productRow?.id ?? input.productId,
      slug: productRow?.slug ?? "",
      canonicalName: productRow?.canonicalName ?? "",
      imageUrl: productRow?.imageUrl ?? null,
      currentBestPriceCents: await bestPriceForProduct(input.productId),
    },
  };
}

export async function bestPriceForProduct(productId: string): Promise<number | null> {
  const [row] = await db
    .select({ best: sql<number | null>`min(${storeListings.priceCents})::int` })
    .from(storeListings)
    .where(eq(storeListings.productId, productId));
  return row?.best ?? null;
}

export async function listAlertsByEmail(email: string): Promise<AlertDTO[]> {
  const alertRows = await db
    .select({
      id: priceAlerts.id,
      email: priceAlerts.email,
      targetPriceCents: priceAlerts.targetPriceCents,
      active: priceAlerts.active,
      createdAt: priceAlerts.createdAt,
      productId: priceAlerts.productId,
      slug: products.slug,
      canonicalName: products.canonicalName,
      imageUrl: products.imageUrl,
    })
    .from(priceAlerts)
    .innerJoin(products, eq(products.id, priceAlerts.productId))
    .where(and(eq(priceAlerts.email, email), eq(priceAlerts.active, true)))
    .orderBy(desc(priceAlerts.createdAt))
    .limit(100);

  return Promise.all(
    alertRows.map(async (row) => ({
      id: row.id,
      email: row.email,
      targetPriceCents: row.targetPriceCents,
      active: row.active,
      createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
      product: {
        id: row.productId,
        slug: row.slug,
        canonicalName: row.canonicalName,
        imageUrl: row.imageUrl ?? null,
        currentBestPriceCents: await bestPriceForProduct(row.productId),
      },
    }))
  );
}

/**
 * Hidrata ProductSummaryDTO completos para un conjunto arbitrario de ids de
 * producto (favoritos, ítems de listas, alertas). Los productos sin listings
 * activos quedan fuera del Map (el llamador decide cómo degradarlos).
 */
export async function hydrateProductSummaries(
  productIds: string[]
): Promise<Map<string, ProductSummaryDTO>> {
  const summaries = new Map<string, ProductSummaryDTO>();
  if (productIds.length === 0) return summaries;

  const uniqueIds = [...new Set(productIds)];
  const agg = listingStatsSubquery();
  const rows = await db
    .select(summarySelect(agg))
    .from(products)
    .innerJoin(agg, eq(agg.productId, products.id))
    .where(inArray(products.id, uniqueIds));
  const listingRows = await fetchListingRows(rows.map((row) => row.id));
  for (const row of rows) {
    summaries.set(
      row.id,
      buildSummaryDTO(row, buildListingDTOs(listingRows.get(row.id) ?? []))
    );
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Adaptadores compactos para las tools del asistente IA
// ---------------------------------------------------------------------------
export interface AiProductBrief {
  name: string;
  slug: string;
  brand: string | null;
  category: string;
  bestPrice: string; // USD formateado
  bestPriceCents: number;
  bestStore: string;
  bestUrl: string;
  savings: string;
  storeCount: number;
}

export function toAiBrief(item: ProductSummaryDTO): AiProductBrief {
  return {
    name: item.canonicalName,
    slug: item.slug,
    brand: item.brand,
    category: item.category,
    bestPrice: formatUsdFromCents(item.bestPriceCents),
    bestPriceCents: item.bestPriceCents,
    bestStore: item.bestStore?.name ?? "—",
    bestUrl: item.bestStore?.url ?? "",
    savings: formatUsdFromCents(item.savingsCents),
    storeCount: item.storeCount,
  };
}

export async function toolSearchProducts(input: {
  query?: string;
  category?: string;
  limit?: number;
}): Promise<{ total: number; items: AiProductBrief[] }> {
  const result = await searchProducts({
    q: input.query,
    category:
      input.category &&
      (PRODUCT_CATEGORIES as readonly string[]).includes(input.category)
        ? (input.category as ProductCategory)
        : undefined,
    sort: "best-savings",
    page: 1,
    limit: Math.min(Math.max(input.limit ?? 5, 1), 10),
  });
  return {
    total: result.pagination.total,
    items: result.items.map(toAiBrief),
  };
}

export async function toolCompareProductPrices(input: {
  query: string;
}): Promise<
  | { found: false; message: string; suggestions: AiProductBrief[] }
  | {
      found: true;
      product: {
        name: string;
        slug: string;
        brand: string | null;
        bestPrice: string;
        savings: string;
        listings: Array<{
          store: string;
          price: string;
          deltaFromBest: string;
          inStock: boolean;
          url: string;
          lastCheckedAt: string;
        }>;
      };
    }
> {
  const detail = await getProductBySlug(
    input.query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  );
  const resolved = detail ?? (await resolveBestMatchForAi(input.query));
  if (!resolved) {
    const suggestions = await toolSearchProducts({ query: input.query, limit: 3 });
    return {
      found: false,
      message: "No encontré ese producto exacto en el catálogo.",
      suggestions: suggestions.items,
    };
  }
  const best = resolved.listings[0]?.priceCents ?? resolved.bestPriceCents;
  return {
    found: true,
    product: {
      name: resolved.canonicalName,
      slug: resolved.slug,
      brand: resolved.brand,
      bestPrice: formatUsdFromCents(resolved.bestPriceCents),
      savings: formatUsdFromCents(resolved.savingsCents),
      listings: resolved.listings.map((listing) => ({
        store: listing.storeName,
        price: formatUsdFromCents(listing.priceCents),
        deltaFromBest: formatUsdFromCents(Math.max(0, listing.priceCents - best)),
        inStock: listing.inStock,
        url: listing.url,
        lastCheckedAt: listing.lastCheckedAt,
      })),
    },
  };
}

export async function toolGetBestDeals(input: {
  limit?: number;
}): Promise<{ items: AiProductBrief[] }> {
  const items = await getBestDeals(Math.min(Math.max(input.limit ?? 5, 1), 10));
  return { items: items.map(toAiBrief) };
}

async function resolveBestMatchForAi(
  query: string
): Promise<ProductDetailDTO | null> {
  // Fallback progresivo: la consulta completa, luego recortando términos
  // desde el final, y por último cada término individual.
  const tokens = query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const candidates: string[] = [];
  for (let take = tokens.length; take >= 1; take -= 1) {
    candidates.push(tokens.slice(0, take).join(" "));
  }
  for (const token of tokens) {
    candidates.push(token);
  }
  candidates.push(query);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const result = await searchProducts({
      q: candidate,
      sort: "best-savings",
      page: 1,
      limit: 1,
    });
    const top = result.items[0];
    if (top) return getProductBySlug(top.slug);
  }
  return null;
}

// ============================================================================
// Motor de comparación de productos SIMILARES entre tiendas (Sprint 2)
// ============================================================================
// Scoring (0 a 100):
//   +25 otra tienda distinta a las que ya tienen el producto actual
//   +25 misma marca
//   +25 atributos técnicos compartidos (pulgadas, BTU, capacidad, subtipo)
//   +20 similitud de tokens del título (Jaccard, proporcional)
//   +15 proximidad de precio (±45%)
// Con diversidad de tiendas: máximo 3 resultados por tienda en el top.

export interface SimilarProductTarget {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: ProductCategory;
  bestPriceCents: number;
  specs: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Extracción de atributos (specs primero, regex del título como fallback)
// ---------------------------------------------------------------------------
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[,.](?=\d{3})/g, "").replace(",", "."));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function extractScreenInches(
  title: string,
  specs: Record<string, unknown> | null
): number | null {
  const fromSpecs = asNumber(specs?.screenSizeInches);
  if (fromSpecs !== null) return fromSpecs;
  const match = title.match(/\b(32|40|43|50|55|65|75|85)\s*(?:"|pulg)/i);
  return match ? Number(match[1]) : null;
}

function extractBtu(title: string, specs: Record<string, unknown> | null): number | null {
  const fromSpecs = asNumber(specs?.btu);
  if (fromSpecs !== null) return fromSpecs;
  const match = title.match(/\b(9|12|18|24),?000\s*btu/i);
  return match ? Number(match[1]) * 1000 : null;
}

function extractCapacityKg(
  title: string,
  specs: Record<string, unknown> | null
): number | null {
  const fromSpecs = asNumber(specs?.capacityKg);
  if (fromSpecs !== null) return fromSpecs;
  const match = title.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*kg\b/i);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function extractCapacityCuFt(
  title: string,
  specs: Record<string, unknown> | null
): number | null {
  const fromSpecs = asNumber(specs?.capacityCuFt);
  if (fromSpecs !== null) return fromSpecs;
  const match = title.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*pies\b/i);
  return match ? Number(match[1].replace(",", ".")) : null;
}

// ---------------------------------------------------------------------------
// Subtipo clave del producto (mouse, lavadora, consola, ...)
// ---------------------------------------------------------------------------
const SUBTYPES: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "mouse", label: "Mouse", pattern: /\bmouse|rat[oó]n\b/i },
  { key: "teclado", label: "Teclado", pattern: /\bteclado|keyboard\b/i },
  { key: "laptop", label: "Laptop", pattern: /\blaptop|notebook|macbook|chromebook\b/i },
  { key: "monitor", label: "Monitor", pattern: /\bmonitor\b/i },
  { key: "lavadora", label: "Lavadora", pattern: /\blavadora\b/i },
  { key: "secadora", label: "Secadora", pattern: /\bsecadora\b/i },
  {
    key: "refrigeradora",
    label: "Refrigeradora",
    pattern: /\brefrigeradora|nevera|frigor[ií]fico|side\s*by\s*side\b/i,
  },
  { key: "estufa", label: "Estufa", pattern: /\bestufa\b/i },
  { key: "microondas", label: "Microondas", pattern: /\bmicroondas\b/i },
  { key: "impresora", label: "Impresora", pattern: /\bimpresora|printer\b/i },
  { key: "audifono", label: "Audífono", pattern: /\baud[ií]fono|headset\b/i },
  {
    key: "bocina",
    label: "Bocina",
    pattern: /\bbocina|parlante|speaker|soundbar|subwoofer\b/i,
  },
  { key: "router", label: "Router", pattern: /\brouter\b/i },
  { key: "ssd", label: "SSD", pattern: /\bssd\b/i },
  { key: "ups", label: "UPS", pattern: /\bups\b|no.?break/i },
  {
    key: "celular",
    label: "Celular",
    pattern: /\bcelular|smartphone|iphone|galaxy\s*s\b/i,
  },
  { key: "tablet", label: "Tablet", pattern: /\btablet|ipad\b/i },
  {
    key: "consola",
    label: "Consola",
    pattern: /\bconsola|playstation|ps5|xbox|nintendo\b/i,
  },
];

function extractSubtype(
  title: string,
  specs: Record<string, unknown> | null
): { key: string; label: string } | null {
  // applianceKind guardado por el scraper tiene prioridad
  const applianceKind =
    typeof specs?.applianceKind === "string" ? specs.applianceKind.toLowerCase() : "";
  if (applianceKind) {
    const known = SUBTYPES.find((subtype) => applianceKind.includes(subtype.key));
    if (known) return { key: known.key, label: known.label };
  }
  for (const subtype of SUBTYPES) {
    if (subtype.pattern.test(title)) {
      return { key: subtype.key, label: subtype.label };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Similitud de tokens del título (Jaccard sin stopwords)
// ---------------------------------------------------------------------------
const TITLE_STOPWORDS = new Set([
  "de", "la", "el", "en", "con", "para", "por", "y", "a", "un", "una", "del",
  "los", "las", "con", "sin", "panama", "original", "nuevo", "nueva", "oferta",
  "promo", "color", "negro", "blanco", "gris", "plata", "azul", "rojo", "inc",
  "ltr", "new", "the", "and", "with", "for", "free", "envio", "gratis", "garantia",
]);

function titleTokens(title: string): Set<string> {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = new Set<string>();
  for (const raw of normalized.split(/[^a-z0-9.]+/)) {
    const token = raw.replace(/\.$/, "").trim();
    if (token.length >= 3 && !TITLE_STOPWORDS.has(token) && !/^\d+$/.test(token)) {
      tokens.add(token);
    } else if (/^\d{2,}$/.test(token)) {
      // Números de tamaño/modelo sí son señal (55, 240, ...)
      tokens.add(token);
    }
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Búsqueda + scoring de candidatos
// ---------------------------------------------------------------------------
interface SimilarCandidateRow {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: string;
  imageUrl: string | null;
  specs: Record<string, unknown> | null;
  bestPriceCents: number;
  storeCount: number;
}

export async function findSimilarProducts(
  target: SimilarProductTarget,
  targetStoreSlugs: string[],
  limit: number
): Promise<SimilarProductDTO[]> {
  if (target.bestPriceCents <= 0) return [];

  // Ventana SQL de candidatos: el agregado de precios se acota a la categoría
  // del target (no a toda la tabla) y el orden combina proximidad de precio +
  // bonus de marca, con LIMIT en SQL. Así el motor responde en <120ms incluso
  // con 3,000+ productos en la categoría: PostgreSQL ordena miles de filas
  // indexadas y solo las 150 mejores llegan al scoring en JS.
  const SIMILAR_CANDIDATE_SQL_LIMIT = 150;

  const candStats = db
    .select({
      productId: storeListings.productId,
      bestPriceCents:
        sql<number>`min(${storeListings.priceCents})::int`.as("best_price_cents"),
      storeCount:
        sql<number>`count(distinct ${storeListings.storeId})::int`.as("store_count"),
    })
    .from(storeListings)
    .innerJoin(products, eq(products.id, storeListings.productId))
    .where(
      and(
        eq(products.category, target.category),
        sql`${products.id} <> ${target.id}`
      )
    )
    .groupBy(storeListings.productId)
    .as("cand_stats");

  const targetBrandLower = target.brand?.toLowerCase() ?? "";
  // Orden SQL: proximidad de precio con bonus de marca ($20 de ventaja en el
  // ranking). La marca prefiere entre candidatos de precio similar, pero NO
  // puede monopolizar la ventana: siempre entran candidatos de otras
  // marcas/tiendas para el scoring y la diversidad en JS.
  const candidates = (await db
    .select({
      id: products.id,
      slug: products.slug,
      canonicalName: products.canonicalName,
      brand: products.brand,
      modelNumber: products.modelNumber,
      category: products.category,
      imageUrl: products.imageUrl,
      specs: products.specs,
      bestPriceCents: candStats.bestPriceCents,
      storeCount: candStats.storeCount,
    })
    .from(products)
    .innerJoin(candStats, eq(candStats.productId, products.id))
    .where(
      and(
        eq(products.category, target.category),
        sql`${products.id} <> ${target.id}`,
        gte(candStats.bestPriceCents, 1)
      )
    )
    .orderBy(
      asc(
        sql`abs(${candStats.bestPriceCents} - ${target.bestPriceCents}) - (case when ${products.brand} is not null and lower(${products.brand}) = ${targetBrandLower} then 2000 else 0 end)`
      )
    )
    .limit(SIMILAR_CANDIDATE_SQL_LIMIT)) as SimilarCandidateRow[];

  if (candidates.length === 0) return [];

  const targetListingRows = await fetchListingRows(candidates.map((candidate) => candidate.id));
  const targetTitleTokenSet = titleTokens(target.canonicalName);
  const targetSubtype = extractSubtype(target.canonicalName, target.specs);
  const targetScreen = extractScreenInches(target.canonicalName, target.specs);
  const targetBtu = extractBtu(target.canonicalName, target.specs);
  const targetKg = extractCapacityKg(target.canonicalName, target.specs);
  const targetCuFt = extractCapacityCuFt(target.canonicalName, target.specs);

  const scored: SimilarProductDTO[] = [];
  for (const candidate of candidates) {
    const listingRows = targetListingRows.get(candidate.id) ?? [];
    const cheapest = listingRows[0];
    if (!cheapest) continue;
    const bestPrice = cheapest.priceCents;
    const bestStoreSlug = cheapest.storeSlug;

    let score = 0;
    const matchReasons: string[] = [];

    // +25 otra tienda
    if (!targetStoreSlugs.includes(bestStoreSlug)) {
      score += 25;
      matchReasons.push(`Disponible en ${cheapest.storeName}`);
    }

    // +25 misma marca
    if (
      target.brand &&
      candidate.brand &&
      target.brand.toLowerCase() === candidate.brand.toLowerCase()
    ) {
      score += 25;
      matchReasons.push(`Misma marca (${candidate.brand})`);
    }

    // +25 atributos técnicos compartidos (una vez, con todas las razones)
    const attributeReasons: string[] = [];
    const candidateSubtype = extractSubtype(candidate.canonicalName, candidate.specs);
    if (
      targetSubtype &&
      candidateSubtype &&
      targetSubtype.key === candidateSubtype.key
    ) {
      attributeReasons.push(`Mismo tipo: ${candidateSubtype.label}`);
    }
    const candidateScreen = extractScreenInches(candidate.canonicalName, candidate.specs);
    if (targetScreen !== null && candidateScreen === targetScreen) {
      attributeReasons.push(`Mismo tamaño (${candidateScreen}")`);
    }
    const candidateBtu = extractBtu(candidate.canonicalName, candidate.specs);
    if (targetBtu !== null && candidateBtu === targetBtu) {
      attributeReasons.push(`Misma capacidad (${candidateBtu.toLocaleString("en-US")} BTU)`);
    }
    const candidateKg = extractCapacityKg(candidate.canonicalName, candidate.specs);
    if (targetKg !== null && candidateKg === targetKg) {
      attributeReasons.push(`Misma capacidad (${candidateKg} kg)`);
    }
    const candidateCuFt = extractCapacityCuFt(candidate.canonicalName, candidate.specs);
    if (targetCuFt !== null && candidateCuFt === targetCuFt) {
      attributeReasons.push(`Misma capacidad (${candidateCuFt} pies cúbicos)`);
    }
    if (attributeReasons.length > 0) {
      score += 25;
      matchReasons.push(...attributeReasons);
    }

    // +20 similitud de tokens (proporcional a Jaccard)
    const similarity = jaccard(targetTitleTokenSet, titleTokens(candidate.canonicalName));
    if (similarity > 0) {
      score += Math.round(20 * similarity);
      if (similarity >= 0.25) {
        matchReasons.push("Nombre parecido");
      }
    }

    // +15 proximidad de precio (±45%)
    const priceDiffCents = bestPrice - target.bestPriceCents;
    const priceRatio = Math.abs(priceDiffCents) / target.bestPriceCents;
    if (priceRatio <= 0.45) {
      score += 15;
      matchReasons.push("Rango de precio similar");
    }

    if (score <= 0) continue;

    scored.push({
      id: candidate.id,
      slug: candidate.slug,
      canonicalName: candidate.canonicalName,
      brand: candidate.brand,
      modelNumber: candidate.modelNumber,
      category: candidate.category as ProductCategory,
      imageUrl: candidate.imageUrl ?? null,
      bestPriceCents: bestPrice,
      priceDiffCents,
      priceDiffPercent: Math.round((priceDiffCents / target.bestPriceCents) * 100),
      similarityScore: Math.min(100, score),
      matchReasons,
      storeCount: candidate.storeCount,
      bestStore: {
        slug: bestStoreSlug,
        name: cheapest.storeName,
        color: cheapest.storeColor,
        accentBg: cheapest.storeAccentBg,
        url: cheapest.url,
        inStock: cheapest.inStock,
      },
    });
  }

  // Diversidad de tiendas: máx ~3 por tienda, relajado solo cuando no hay
  // más candidatos; para rellenar se priorizan las tiendas menos usadas.
  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  const perStore = new Map<string, number>();
  const picked: SimilarProductDTO[] = [];
  const deferred: SimilarProductDTO[] = [];
  for (const candidate of scored) {
    const used = perStore.get(candidate.bestStore.slug) ?? 0;
    if (used < 3) {
      perStore.set(candidate.bestStore.slug, used + 1);
      picked.push(candidate);
    } else {
      deferred.push(candidate);
    }
  }
  const result = [...picked];
  if (result.length < limit && deferred.length > 0) {
    const fillByStoreUsage = deferred
      .slice()
      .sort(
        (a, b) =>
          (perStore.get(a.bestStore.slug) ?? 0) -
          (perStore.get(b.bestStore.slug) ?? 0)
      );
    for (const candidate of fillByStoreUsage) {
      if (result.length >= limit) break;
      result.push(candidate);
    }
  }
  return result
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Endpoint público: similares por slug
// ---------------------------------------------------------------------------
export async function getSimilarProductsForSlug(
  slug: string,
  limit = 8
): Promise<{
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    bestPriceCents: number;
    category: ProductCategory;
  };
  items: SimilarProductDTO[];
} | null> {
  const agg = listingStatsSubquery();
  const [target] = await db
    .select({
      id: products.id,
      slug: products.slug,
      canonicalName: products.canonicalName,
      brand: products.brand,
      modelNumber: products.modelNumber,
      category: products.category,
      bestPriceCents: agg.bestPriceCents,
      specs: products.specs,
    })
    .from(products)
    .innerJoin(agg, eq(agg.productId, products.id))
    .where(eq(products.slug, slug))
    .limit(1);

  if (!target) return null;

  const targetStoreRows = await db
    .select({ storeSlug: stores.slug })
    .from(storeListings)
    .innerJoin(stores, eq(stores.id, storeListings.storeId))
    .where(eq(storeListings.productId, target.id));

  const items = await findSimilarProducts(
    {
      id: target.id,
      slug: target.slug,
      canonicalName: target.canonicalName,
      brand: target.brand,
      modelNumber: target.modelNumber,
      category: target.category as ProductCategory,
      bestPriceCents: target.bestPriceCents,
      specs: target.specs ?? null,
    },
    targetStoreRows.map((row) => row.storeSlug),
    limit
  );

  return {
    product: {
      id: target.id,
      slug: target.slug,
      canonicalName: target.canonicalName,
      bestPriceCents: target.bestPriceCents,
      category: target.category as ProductCategory,
    },
    items,
  };
}
