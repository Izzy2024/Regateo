// ============================================================================
// Motor de comparación de productos SIMILARES entre tiendas.
// Scoring (0 a 100):
//   +25 otra tienda distinta a las que ya tienen el producto actual
//   +25 misma marca
//   +25 atributos técnicos compartidos (pulgadas, BTU, capacidad, subtipo)
//   +20 similitud de tokens del título (Jaccard, proporcional)
//   +15 proximidad de precio (±45%)
// Con diversidad de tiendas: máximo ~3 resultados por tienda en el top.
// ============================================================================
import {
  db,
  and,
  asc,
  eq,
  gte,
  sql,
  products,
  storeListings,
  stores,
} from "@regateo/db";
import type { ProductCategory, SimilarProductDTO } from "@regateo/shared";
import { fetchListingRows, statsForProducts } from "./shared";

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
    const parsed = Number.parseFloat(
      value.replace(/[,.](?=\d{3})/g, "").replace(",", ".")
    );
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

function extractBtu(
  title: string,
  specs: Record<string, unknown> | null
): number | null {
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
  {
    key: "laptop",
    label: "Laptop",
    pattern: /\blaptop|notebook|macbook|chromebook\b/i,
  },
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
    typeof specs?.applianceKind === "string"
      ? specs.applianceKind.toLowerCase()
      : "";
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
  "los", "las", "sin", "panama", "original", "nuevo", "nueva", "oferta",
  "promo", "color", "negro", "blanco", "gris", "plata", "azul", "rojo", "inc",
  "ltr", "new", "the", "and", "with", "for", "free", "envio", "gratis",
  "garantia",
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
  // con 3,000+ productos en la categoría.
  const SIMILAR_CANDIDATE_SQL_LIMIT = 150;

  const candStats = db
    .select({
      productId: storeListings.productId,
      bestPriceCents:
        sql<number>`min(${storeListings.priceCents})::int`.as("cand_best_price_cents"),
      storeCount:
        sql<number>`count(distinct ${storeListings.storeId})::int`.as("cand_store_count"),
    })
    .from(storeListings)
    .innerJoin(products, eq(products.id, storeListings.productId))
    .where(
      and(eq(products.category, target.category), sql`${products.id} <> ${target.id}`)
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

  const candidateListingRows = await fetchListingRows(
    candidates.map((candidate) => candidate.id)
  );
  const targetTitleTokenSet = titleTokens(target.canonicalName);
  const targetSubtype = extractSubtype(target.canonicalName, target.specs);
  const targetScreen = extractScreenInches(target.canonicalName, target.specs);
  const targetBtu = extractBtu(target.canonicalName, target.specs);
  const targetKg = extractCapacityKg(target.canonicalName, target.specs);
  const targetCuFt = extractCapacityCuFt(target.canonicalName, target.specs);

  const scored: SimilarProductDTO[] = [];
  for (const candidate of candidates) {
    const listingRows = candidateListingRows.get(candidate.id) ?? [];
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
    if (targetSubtype && candidateSubtype && targetSubtype.key === candidateSubtype.key) {
      attributeReasons.push(`Mismo tipo: ${candidateSubtype.label}`);
    }
    const candidateScreen = extractScreenInches(candidate.canonicalName, candidate.specs);
    if (targetScreen !== null && candidateScreen === targetScreen) {
      attributeReasons.push(`Mismo tamaño (${candidateScreen}")`);
    }
    const candidateBtu = extractBtu(candidate.canonicalName, candidate.specs);
    if (targetBtu !== null && candidateBtu === targetBtu) {
      attributeReasons.push(
        `Misma capacidad (${candidateBtu.toLocaleString("en-US")} BTU)`
      );
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
    const similarity = jaccard(
      targetTitleTokenSet,
      titleTokens(candidate.canonicalName)
    );
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
          (perStore.get(a.bestStore.slug) ?? 0) - (perStore.get(b.bestStore.slug) ?? 0)
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
// Endpoint público: similares por slug (target materializado con fallback)
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
  const [target] = await db
    .select({
      id: products.id,
      slug: products.slug,
      canonicalName: products.canonicalName,
      brand: products.brand,
      modelNumber: products.modelNumber,
      category: products.category,
      bestPriceCents: products.bestPriceCents,
      specs: products.specs,
    })
    .from(products)
    .where(eq(products.slug, slug))
    .limit(1);

  if (!target) return null;

  // Fallback por fila: producto aún no materializado → agregado en vivo
  if (target.bestPriceCents === null) {
    const fallback = await statsForProducts([target.id]);
    const statsRow = fallback.get(target.id);
    if (statsRow) {
      target.bestPriceCents = statsRow.bestPriceCents;
    } else {
      return null; // sin listings activos
    }
  }

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

