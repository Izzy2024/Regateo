// ============================================================================
// Guías automáticas de compra (Fase 3): se generan dinámicamente desde los
// datos reales en stock, ordenadas por comparabilidad (tiendas) y precio.
// ============================================================================
import { db, and, eq, gte, lte, or, sql, products } from "@regateo/db";
import type { BuyingGuideDTO, ProductSummaryDTO } from "@regateo/shared";
import { hydrateProductSummaries, type SqlCondition } from "./shared";

// ---------------------------------------------------------------------------
// Definiciones de guías (datos reales en stock, sin hardcodear productos)
// ---------------------------------------------------------------------------
interface GuideDefinition {
  slug: string;
  title: string;
  subtitle: string;
  category: string | null;
  maxPriceUsd: number | null;
  /** Filtros SQL extra sobre columnas materializadas. */
  extraWhere?: () => ReturnType<typeof and> | undefined;
  orderBy?: "stores-then-price" | "price-asc";
  requireMultiStore?: boolean;
}

const GUIDE_DEFINITIONS: GuideDefinition[] = [
  {
    slug: "mejores-tv-55-panama",
    title: 'Mejores Smart TV de 55" en Panamá hoy',
    subtitle:
      "Los televisores de 55 pulgadas con mejor precio y más tiendas comparadas en Panamá.",
    category: "televisores",
    maxPriceUsd: null,
    extraWhere: () =>
      or(
        sql`${products.specs} ->> 'screenSizeInches' = '55'`,
        sql`${products.canonicalName} ilike '%55%'`
      ) as ReturnType<typeof and>,
    orderBy: "stores-then-price",
  },
  {
    slug: "laptops-menos-700-panama",
    title: "Mejores laptops por menos de $700 en Panamá",
    subtitle:
      "Laptops reales comparadas entre tiendas panameñas por debajo de $700 (sin tablets ni accesorios).",
    category: "computadoras",
    maxPriceUsd: 700,
    extraWhere: () =>
      and(
        gte(products.bestPriceCents, 18000),
        lte(products.bestPriceCents, 70000),
        sql`unaccent(lower(${products.canonicalName})) ~ '\\m(laptop|notebook|macbook|chromebook|ultrabook|portatil)\\M'`,
        sql`unaccent(lower(${products.canonicalName})) !~ '\\m(teclado|keyboard|mouse|raton|tablet|ipad|monitor|funda|estuche|mochila|maletin|soporte|base|cargador|adaptador|cable|bateria|tinta|cartucho|accesorio)\\M'`
      ),
    orderBy: "stores-then-price",
  },
  {
    slug: "celulares-mejor-precio-panama",
    title: "Celulares comparados en múltiples tiendas de Panamá",
    subtitle:
      "Los celulares disponibles en 2+ tiendas, donde el ahorro entre tiendas es real y verificable.",
    category: "celulares",
    maxPriceUsd: null,
    requireMultiStore: true,
    orderBy: "stores-then-price",
  },
  {
    slug: "linea-blanca-ofertas-panama",
    title: "Mejores precios en Línea Blanca en Panamá",
    subtitle:
      "Lavadoras, refrigeradoras y estufas comparadas entre varias tiendas panameñas.",
    category: "linea-blanca",
    maxPriceUsd: null,
    requireMultiStore: true,
    orderBy: "stores-then-price",
  },
];

const GUIDE_ITEM_LIMIT = 8;

async function buildGuide(definition: GuideDefinition): Promise<BuyingGuideDTO> {
  const conditions: SqlCondition[] = [
    // Solo productos con materialización/precio válido y stock real
    sql`${products.bestPriceCents} is not null`,
    sql`${products.inStockCount} > 0`,
  ];
  if (definition.category) {
    conditions.push(eq(products.category, definition.category) as SqlCondition);
  }
  if (definition.requireMultiStore) {
    conditions.push(gte(products.storeCount, 2) as SqlCondition);
  }
  const extra = definition.extraWhere?.();
  if (extra) {
    conditions.push(extra as SqlCondition);
  }

  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(...conditions))
    .orderBy(
      ...(definition.orderBy === "price-asc"
        ? [sql`${products.bestPriceCents} asc`]
        : [sql`${products.storeCount} desc`, sql`${products.bestPriceCents} asc`])
    )
    .limit(GUIDE_ITEM_LIMIT);

  const summaries = await hydrateProductSummaries(rows.map((row) => row.id));
  const items: ProductSummaryDTO[] = [];
  for (const row of rows) {
    const summary = summaries.get(row.id);
    if (summary) items.push(summary);
  }

  return {
    slug: definition.slug,
    title: definition.title,
    subtitle: definition.subtitle,
    category: (definition.category ?? null) as BuyingGuideDTO["category"],
    maxPriceUsd: definition.maxPriceUsd,
    updatedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };
}

export async function getBuyingGuides(): Promise<BuyingGuideDTO[]> {
  return Promise.all(GUIDE_DEFINITIONS.map((definition) => buildGuide(definition)));
}

export async function getBuyingGuideBySlug(
  slug: string
): Promise<BuyingGuideDTO | null> {
  const definition = GUIDE_DEFINITIONS.find((candidate) => candidate.slug === slug);
  if (!definition) return null;
  return buildGuide(definition);
}

export const BUYING_GUIDE_SLUGS = GUIDE_DEFINITIONS.map(
  (definition) => definition.slug
);
