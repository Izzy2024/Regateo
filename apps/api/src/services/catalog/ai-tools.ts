// ============================================================================
// Tools del asistente IA + alertas de precio (creación con doble opt-in).
// ============================================================================
import {
  db,
  eq,
  products,
  priceAlerts,
} from "@regateo/db";
import {
  PRODUCT_CATEGORIES,
  formatUsdFromCents,
  type CreatePriceAlertInput,
  type ProductCategory,
  type ProductDetailDTO,
  type ProductSummaryDTO,
} from "@regateo/shared";
import {
  bestPriceForProduct,
  toIso,
  type AlertDTO,
  type CreatePriceAlertOptions,
} from "./shared";
import { getProductBySlug, searchProducts, getBestDeals } from "./search";

// ---------------------------------------------------------------------------
// Verificación de existencia
// ---------------------------------------------------------------------------
export async function productExistsById(productId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Alertas de precio (doble opt-in gestionado por la ruta en app.ts)
// ---------------------------------------------------------------------------
export async function createPriceAlert(
  input: CreatePriceAlertInput,
  userId?: string | null,
  options: CreatePriceAlertOptions = {}
): Promise<AlertDTO | null> {
  const [alert] = await db
    .insert(priceAlerts)
    .values({
      productId: input.productId,
      email: input.email,
      targetPriceCents: input.targetPriceCents,
      active: true,
      userId: userId ?? null,
      // Doble opt-in (Ley 81): invitados nacen sin verificar + confirmToken
      verified: options.verified ?? false,
      confirmToken: options.confirmToken ?? null,
      confirmedAt: options.confirmedAt ?? null,
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
    verified: alert.verified,
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
    sort: input.query ? "relevance" : "best-savings",
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
    input.query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
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
      sort: "relevance",
      page: 1,
      limit: 1,
    });
    const top = result.items[0];
    if (top) return getProductBySlug(top.slug);
  }
  return null;
}
