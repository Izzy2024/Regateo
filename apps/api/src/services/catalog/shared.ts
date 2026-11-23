// ============================================================================
// Módulo compartido del catálogo: tipos DTO, columnas de stats unificadas
// (materializadas en `products` o agregadas en vivo sobre `store_listings`),
// hidratación de listings (incluyendo `color`) y helpers de precios/ahorro.
// ============================================================================
import {
  db,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  sql,
  products,
  storeListings,
  stores,
  searchEvents,
} from "@regateo/db";
import type {
  ProductCategory,
  ProductSearchQuery,
  ProductSummaryDTO,
  StoreListingDTO,
} from "@regateo/shared";
import {
  analyzeSearchQuery,
  buildRelevanceTierExpr,
  buildSearchConditions,
  type SearchMetaDTO,
  type SearchPlan,
} from "./search-intent";

export {
  analyzeSearchQuery,
  type SearchMetaDTO,
  type SearchPlan,
};

// ---------------------------------------------------------------------------
// Tipos públicos del catálogo
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
  /** Productos con 2+ tiendas distintas en stock (comparables reales). */
  comparableCount: number;
  /** Metadatos del motor de búsqueda cuando se envió `q`. */
  searchMeta?: SearchMetaDTO;
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
  verified: boolean;
  createdAt: string;
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    imageUrl: string | null;
    currentBestPriceCents: number | null;
  };
}

export interface CreatePriceAlertOptions {
  verified?: boolean;
  confirmToken?: string | null;
  confirmedAt?: Date | null;
}

export type SqlCondition = ReturnType<typeof eq>;

export function toIso(value: Date | string | null | undefined): string | null {
  return (value instanceof Date ? value.toISOString() : new Date(value as string).toISOString());
}

// ---------------------------------------------------------------------------
// Agregado en vivo de listings (verdad del precio cuando `products` aún no
// tiene materializadas sus columnas de stats).
// ---------------------------------------------------------------------------
export function listingStatsSubquery() {
  return db
    .select({
      productId: storeListings.productId,
      // Alias con prefijo `agg_`: `products` ahora tiene columnas físicas con
      // los mismos nombres (best_price_cents, ...) y las referencias sin
      // prefijo serían ambiguas al unir ambas fuentes.
      bestPriceCents: sql<number>`coalesce((min(${storeListings.priceCents}) filter (where ${storeListings.inStock}))::int, (min(${storeListings.priceCents}))::int)`.as("agg_best_price_cents"),
      highestPriceCents: sql<number>`coalesce((max(${storeListings.priceCents}) filter (where ${storeListings.inStock}))::int, (max(${storeListings.priceCents}))::int)`.as("agg_highest_price_cents"),
      bestListingId: sql<string>`(array_agg(${storeListings.id} order by ${storeListings.inStock} desc, ${storeListings.priceCents} asc))[1]`.as("agg_best_listing_id"),
      storeCount: sql<number>`count(distinct ${storeListings.storeId})::int`.as("agg_store_count"),
      inStockCount:
        sql<number>`(count(*) filter (where ${storeListings.inStock}))::int`.as("agg_in_stock_count"),
      storeCountInStock: sql<number>`(count(distinct ${storeListings.storeId}) filter (where ${storeListings.inStock}))::int`.as("agg_store_count_in_stock"),
    })
    .from(storeListings)
    .groupBy(storeListings.productId)
    .as("listing_stats");
}

export type ListingStats = ReturnType<typeof listingStatsSubquery>;

/**
 * Ahorro REAL y verificable: spread entre tiendas CON STOCK. Si solo hay una
 * tienda con stock no hay comparación posible → 0 (nunca descuentos inflados).
 */
export function savingsExpr(agg: ListingStats) {
  return sql<number>`(case when ${agg.storeCountInStock} >= 2 then greatest(${agg.highestPriceCents} - ${agg.bestPriceCents}, 0) else 0 end)::int`;
}

// ---------------------------------------------------------------------------
// Columnas de stats unificadas: la misma interfaz sirve para la vía rápida
// (columnas materializadas de `products`, indexadas O(1)) o la vía de
// agregado (subquery sobre `store_listings`).
// ---------------------------------------------------------------------------
/**
 * Referencia a una columna de stats: ya sea una columna materializada de
 * `products` o un fragmento SQL del agregado en vivo. Drizzle acepta ambas
 * formas en selects/filters/ordenes; el tipo se relaja porque los overloads
 * de gte/lte/desc no unifican Column y SQL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StatsColumnRef = any;

export interface StatsColumnSet {
  bestPriceCents: StatsColumnRef;
  highestPriceCents: StatsColumnRef;
  savingsCents: StatsColumnRef;
  storeCount: StatsColumnRef;
  inStockCount: StatsColumnRef;
  /** Condición multi-tienda comparable (exacta en vía agregada). */
  multiStoreCondition: ReturnType<typeof sql>;
}

/** Vía rápida: columnas materializadas de `products`. */
export function materializedStats(): StatsColumnSet {
  return {
    bestPriceCents: products.bestPriceCents,
    highestPriceCents: products.highestPriceCents,
    savingsCents: products.savingsCents,
    storeCount: products.storeCount,
    inStockCount: products.inStockCount,
    // Aproximación (storeCountInStock no está materializada): 2+ tiendas y
    // 2+ listings en stock ≈ comparable multi-tienda.
    multiStoreCondition: sql`(${products.storeCount} >= 2 and ${products.inStockCount} >= 2)`,
  };
}

/** Vía agregada: subquery en vivo sobre `store_listings`. */
export function aggStats(agg: ListingStats): StatsColumnSet {
  return {
    bestPriceCents: agg.bestPriceCents,
    highestPriceCents: agg.highestPriceCents,
    savingsCents: savingsExpr(agg),
    storeCount: agg.storeCount,
    inStockCount: agg.inStockCount,
    multiStoreCondition: sql`${agg.storeCountInStock} >= 2`,
  };
}

// ---------------------------------------------------------------------------
// Flag global de materialización (cacheado 60s): la vía rápida solo se usa
// cuando TODOS los productos tienen `best_price_cents` materializado.
// ---------------------------------------------------------------------------
let materializedCache: { value: boolean; expiresAt: number } | null = null;

export async function isMaterializedReady(): Promise<boolean> {
  if (materializedCache && materializedCache.expiresAt > Date.now()) {
    return materializedCache.value;
  }
  try {
    const [row] = await db
      .select({
        ready: sql<boolean>`not exists (select 1 from products p2 where p2.best_price_cents is null)`,
      })
      .from(products)
      .limit(1);
    const value = row?.ready === true;
    materializedCache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stats en vivo para un conjunto acotado de ids (fallback por fila cuando un
// producto aún no fue materializado).
// ---------------------------------------------------------------------------
export interface ProductStatsRow {
  bestPriceCents: number;
  highestPriceCents: number;
  savingsCents: number;
  storeCount: number;
  inStockCount: number;
}

export async function statsForProducts(
  productIds: string[]
): Promise<Map<string, ProductStatsRow>> {
  const map = new Map<string, ProductStatsRow>();
  if (productIds.length === 0) return map;

  const rows = await db
    .select({
      productId: storeListings.productId,
      bestPriceCents: sql<number>`coalesce((min(${storeListings.priceCents}) filter (where ${storeListings.inStock}))::int, (min(${storeListings.priceCents}))::int)`,
      highestPriceCents: sql<number>`coalesce((max(${storeListings.priceCents}) filter (where ${storeListings.inStock}))::int, (max(${storeListings.priceCents}))::int)`,
      storeCount: sql<number>`count(distinct ${storeListings.storeId})::int`,
      inStockCount: sql<number>`(count(*) filter (where ${storeListings.inStock}))::int`,
      storeCountInStock: sql<number>`(count(distinct ${storeListings.storeId}) filter (where ${storeListings.inStock}))::int`,
    })
    .from(storeListings)
    .where(inArray(storeListings.productId, productIds))
    .groupBy(storeListings.productId);

  for (const row of rows) {
    map.set(row.productId, {
      bestPriceCents: row.bestPriceCents,
      highestPriceCents: row.highestPriceCents,
      savingsCents:
        row.storeCountInStock >= 2
          ? Math.max(0, row.highestPriceCents - row.bestPriceCents)
          : 0,
      storeCount: row.storeCount,
      inStockCount: row.inStockCount,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Filtros y ordenamiento (independientes de la vía de stats)
// ---------------------------------------------------------------------------
export function buildConditions(
  query: ProductSearchQuery,
  stats: StatsColumnSet,
  searchPlan?: SearchPlan | null,
  options: { fuzzy?: boolean } = {}
): SqlCondition[] {
  const conditions: SqlCondition[] = [];

  if (query.q) {
    const plan = searchPlan ?? analyzeSearchQuery(query.q);
    conditions.push(
      ...(buildSearchConditions(plan, options) as unknown as SqlCondition[])
    );
  }
  if (query.category) {
    conditions.push(eq(products.category, query.category) as SqlCondition);
  }
  if (query.brand) {
    conditions.push(
      ilike(products.brand, `%${query.brand}%`) as SqlCondition
    );
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
      gte(stats.bestPriceCents, Math.round(query.minPrice * 100)) as SqlCondition
    );
  }
  if (query.maxPrice !== undefined && query.maxPrice !== null) {
    conditions.push(
      lte(stats.bestPriceCents, Math.round(query.maxPrice * 100)) as SqlCondition
    );
  }
  if (query.inStockOnly) {
    conditions.push(sql`${stats.inStockCount} > 0` as SqlCondition);
  }
  if (query.multiStoreOnly) {
    // Comparables reales: 2+ tiendas DISTINTAS con stock (exacto en la vía
    // agregada; aproximado con storeCount+inStockCount en la materializada)
    conditions.push(stats.multiStoreCondition as SqlCondition);
  }
  return conditions;
}

/** Dispositivos principales: si la búsqueda nombra uno, "accesorios" baja. */
export const MAIN_DEVICE_PATTERN =
  /\b(iphone|galaxy|tv|televisor|laptop|lavadora|monitor|mouse)\b/i;

export function buildOrderBy(
  stats: StatsColumnSet,
  sort: ProductSearchQuery["sort"],
  q?: string,
  searchPlan?: SearchPlan | null,
  options: { fuzzy?: boolean } = {}
): SqlCondition[] {
  // Sin búsqueda textual: comportamiento 100% original.
  if (!q) {
    switch (sort) {
      case "price-asc":
        return [asc(stats.bestPriceCents) as SqlCondition];
      case "price-desc":
        return [desc(stats.bestPriceCents) as SqlCondition];
      case "recent":
        return [desc(products.updatedAt) as SqlCondition];
      case "best-savings":
        return [
          desc(stats.savingsCents) as SqlCondition,
          desc(stats.storeCount) as SqlCondition,
        ];
      case "most-stores":
      default:
        return [
          desc(stats.storeCount) as SqlCondition,
          desc(stats.savingsCents) as SqlCondition,
        ];
    }
  }

  const plan = searchPlan ?? analyzeSearchQuery(q);
  const tierExpr = buildRelevanceTierExpr(stats.bestPriceCents, plan);
  const tierOrder: SqlCondition[] = tierExpr ? [asc(tierExpr) as SqlCondition] : [];
  const simTarget = plan.similarityQuery || q;
  const simScore = options.fuzzy
    ? sql`greatest(word_similarity(unaccent(lower(${simTarget})), unaccent(lower(${products.canonicalName}))), similarity(unaccent(lower(${products.canonicalName})), unaccent(lower(${simTarget}))))`
    : sql`similarity(unaccent(lower(${products.canonicalName})), unaccent(lower(${simTarget})))`;

  // Para consolas principales (PS5, PS4, Xbox, Switch): flagship / bundles primero
  const preferHigherTier = Boolean(
    plan.primaryDevice?.preferHigherTierInRelevance && !plan.userWantsAccessory
  );
  const consoleMinPrice = plan.primaryDevice?.minPriceCents ?? 0;
  const consoleHeadBoost = sql`(case when ${stats.bestPriceCents} >= ${consoleMinPrice} and unaccent(lower(${products.canonicalName})) ~* '(consola|bundle)' then 1 else 0 end)`;

  if (sort === "relevance") {
    if (preferHigherTier) {
      return [
        ...tierOrder,
        desc(consoleHeadBoost) as SqlCondition,
        desc(stats.bestPriceCents) as SqlCondition,
        desc(simScore) as SqlCondition,
        desc(stats.savingsCents) as SqlCondition,
        desc(stats.storeCount) as SqlCondition,
      ];
    }
    return [
      ...tierOrder,
      desc(simScore) as SqlCondition,
      desc(stats.savingsCents) as SqlCondition,
      desc(stats.storeCount) as SqlCondition,
      desc(stats.bestPriceCents) as SqlCondition,
    ];
  }

  switch (sort) {
    case "price-asc":
      return [
        ...tierOrder,
        asc(
          sql`(case when coalesce(${stats.bestPriceCents}, 0) > 0 then 0 else 1 end)`
        ) as SqlCondition,
        asc(stats.bestPriceCents) as SqlCondition,
      ];
    case "price-desc":
      return [...tierOrder, desc(stats.bestPriceCents) as SqlCondition];
    case "recent":
      return [...tierOrder, desc(products.updatedAt) as SqlCondition];
    case "best-savings":
      return [
        ...tierOrder,
        desc(stats.savingsCents) as SqlCondition,
        desc(stats.storeCount) as SqlCondition,
        desc(stats.bestPriceCents) as SqlCondition,
      ];
    case "most-stores":
    default:
      if (preferHigherTier) {
        return [
          ...tierOrder,
          desc(stats.storeCount) as SqlCondition,
          desc(stats.savingsCents) as SqlCondition,
          desc(consoleHeadBoost) as SqlCondition,
          desc(stats.bestPriceCents) as SqlCondition,
        ];
      }
      return [
        ...tierOrder,
        desc(stats.storeCount) as SqlCondition,
        desc(stats.savingsCents) as SqlCondition,
        desc(simScore) as SqlCondition,
        desc(stats.bestPriceCents) as SqlCondition,
      ];
  }
}

// ---------------------------------------------------------------------------
// Hidratación de listings (en stock primero, luego precio asc) + color
// ---------------------------------------------------------------------------
export interface ListingRow {
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
  color: string | null;
  currency: string;
  inStock: boolean;
  url: string;
  imageUrl: string | null;
  lastCheckedAt: Date | string;
}

export async function fetchListingRows(
  productIds: string[]
): Promise<Map<string, ListingRow[]>> {
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
      color: storeListings.color,
      currency: storeListings.currency,
      inStock: storeListings.inStock,
      url: storeListings.url,
      imageUrl: storeListings.imageUrl,
      lastCheckedAt: storeListings.lastCheckedAt,
    })
    .from(storeListings)
    .innerJoin(stores, eq(stores.id, storeListings.storeId))
    .where(inArray(storeListings.productId, productIds))
    // En stock PRIMERO y luego precio ascendente: el listing ganador
    // (listings[0]) nunca es un agotado si otra tienda sí tiene stock.
    .orderBy(desc(storeListings.inStock), asc(storeListings.priceCents));

  for (const row of rows) {
    const bucket = grouped.get(row.productId);
    if (bucket) bucket.push(row);
    else grouped.set(row.productId, [row]);
  }
  return grouped;
}

export function buildListingDTOs(rows: ListingRow[]): StoreListingDTO[] {
  const winner = rows[0];
  const best = winner ? winner.priceCents : 0;
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
    // Color del producto en esa tienda (para la UI)
    color: row.color ?? null,
    currency: row.currency,
    inStock: row.inStock,
    url: row.url,
    imageUrl: row.imageUrl ?? null,
    lastCheckedAt: toIso(row.lastCheckedAt) ?? new Date().toISOString(),
    // isCheapest solo para el listing ganador (en stock y más barato)
    isCheapest: Boolean(winner) && row.id === winner.id,
    deltaFromCheapestCents: row.priceCents - best,
  }));
}

// ---------------------------------------------------------------------------
// Construcción de ProductSummaryDTO
// ---------------------------------------------------------------------------
export function roundSavingsPercent(savingsCents: number, highestCents: number): number {
  if (highestCents <= 0 || savingsCents <= 0) return 0;
  // Nunca > 99% (auditoría: evitar porcentajes absurdos por datos sucios)
  return Math.min(99, Math.round((savingsCents / highestCents) * 10000) / 100);
}

export interface ProductRowLite {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: string;
  imageUrl: string | null;
  updatedAt: Date | string;
  bestPriceCents: number;
  highestPriceCents: number;
  savingsCents: number;
  storeCount: number;
  inStockCount: number;
}

export function buildSummaryDTO(
  row: ProductRowLite,
  listingDTOs: StoreListingDTO[]
): ProductSummaryDTO {
  const bestListing = listingDTOs[0] ?? null;

  // Descuento de la TIENDA ganadora sobre su propio precio original
  // (descartado si el "antes" está inflado: > 65%)
  let storeDiscountCents = 0;
  let storeDiscountPercent = 0;
  if (
    bestListing &&
    bestListing.originalPriceCents &&
    bestListing.originalPriceCents > bestListing.priceCents
  ) {
    const percent =
      ((bestListing.originalPriceCents - bestListing.priceCents) /
        bestListing.originalPriceCents) *
      100;
    if (percent <= 65) {
      storeDiscountCents = bestListing.originalPriceCents - bestListing.priceCents;
      storeDiscountPercent = Math.round(percent * 100) / 100;
    }
  }

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
    // Ahorro verificable SOLO entre tiendas con stock (0 si 1 tienda)
    savingsCents: row.savingsCents,
    savingsPercent: roundSavingsPercent(row.savingsCents, row.highestPriceCents),
    // Descuento anunciado por la tienda ganadora (tope 65% anti-antes inflado)
    storeDiscountCents,
    storeDiscountPercent,
    storeCount: row.storeCount,
    inStockCount: row.inStockCount,
    bestStore: bestListing
      ? {
          slug: bestListing.storeSlug,
          name: bestListing.storeName,
          color: bestListing.storeColor,
          url: bestListing.url,
          listingId: bestListing.id,
          inStock: bestListing.inStock,
        }
      : null,
    listings: listingDTOs,
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}

/** Select uniforme de stats: funciona con la vía materializada o agregada. */
export function summarySelect(stats: StatsColumnSet) {
  return {
    id: products.id,
    slug: products.slug,
    canonicalName: products.canonicalName,
    brand: products.brand,
    modelNumber: products.modelNumber,
    category: products.category,
    imageUrl: products.imageUrl,
    updatedAt: products.updatedAt,
    bestPriceCents: stats.bestPriceCents,
    highestPriceCents: stats.highestPriceCents,
    savingsCents: stats.savingsCents,
    storeCount: stats.storeCount,
    inStockCount: stats.inStockCount,
  };
}

// ---------------------------------------------------------------------------
// Hidratación por ids (favoritos, listas, alertas) — materializada primero
// con fallback por fila al agregado para productos aún no materializados.
// ---------------------------------------------------------------------------
export async function hydrateProductSummaries(
  productIds: string[]
): Promise<Map<string, ProductSummaryDTO>> {
  const summaries = new Map<string, ProductSummaryDTO>();
  if (productIds.length === 0) return summaries;

  const uniqueIds = [...new Set(productIds)];
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      canonicalName: products.canonicalName,
      brand: products.brand,
      modelNumber: products.modelNumber,
      category: products.category,
      imageUrl: products.imageUrl,
      updatedAt: products.updatedAt,
      bestPriceCents: products.bestPriceCents,
      highestPriceCents: products.highestPriceCents,
      savingsCents: products.savingsCents,
      storeCount: products.storeCount,
      inStockCount: products.inStockCount,
    })
    .from(products)
    .where(inArray(products.id, uniqueIds));

  const unmaterializedIds = rows
    .filter((row) => row.bestPriceCents === null)
    .map((row) => row.id);
  const fallback =
    unmaterializedIds.length > 0 ? await statsForProducts(unmaterializedIds) : null;

  const listingRows = await fetchListingRows(rows.map((row) => row.id));
  for (const row of rows) {
    // Sin listings activos: fuera del Map (igual que la vía de agregado).
    if (row.bestPriceCents === null && !fallback?.has(row.id)) continue;
    const statsRow: ProductRowLite =
      row.bestPriceCents !== null
        ? (row as unknown as ProductRowLite)
        : { ...row, ...(fallback?.get(row.id) as ProductStatsRow) };
    summaries.set(
      row.id,
      buildSummaryDTO(statsRow, buildListingDTOs(listingRows.get(row.id) ?? []))
    );
  }
  return summaries;
}

/** Mejor precio en stock de un producto (agregado en vivo, 1 fila). */
export async function bestPriceForProduct(productId: string): Promise<number | null> {
  const [row] = await db
    .select({
      best: sql<
        number | null
      >`coalesce((min(${storeListings.priceCents}) filter (where ${storeListings.inStock}))::int, (min(${storeListings.priceCents}))::int)`,
    })
    .from(storeListings)
    .where(eq(storeListings.productId, productId));
  return row?.best ?? null;
}

/** Registro asíncrono de búsquedas (fire-and-forget, nunca bloquea). */
export function trackSearchEvent(
  query: string,
  category: string | null,
  resultsCount: number
): void {
  if (!query || query.trim().length < 2) return;
  void db
    .insert(searchEvents)
    .values({
      query: query.trim().slice(0, 200),
      category,
      resultsCount,
    })
    .catch(() => {
      // analítica: errores silenciosos
    });
}
