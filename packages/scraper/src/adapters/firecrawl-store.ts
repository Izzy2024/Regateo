import { load, type CheerioAPI } from "cheerio";
import type { PanamaStoreConfig } from "@regateo/shared";
import { getFirecrawlClient } from "../firecrawl-client";
import { fetchText } from "../http";
import {
  dedupeItems,
  findUsdPriceCents,
  isRelevantElectronicsProduct,
  parsePriceToCents,
} from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * Generic Firecrawl adapter for Panamanian stores without a public JSON API.
 *
 * It is the fallback used for any `firecrawl-html` store (or a new store added
 * to `PANAMA_STORES` without a dedicated adapter): plain HTTP often returns an
 * empty SPA shell, so Firecrawl renders the page first. Parsing is layered:
 *
 *   1. schema.org JSON-LD `Product` / `ItemList` (most reliable).
 *   2. WooCommerce / Magento / Shopify theme markup.
 *   3. Link + price heuristic for bespoke themes.
 *
 * A store that changes its layout or blocks us simply yields 0 items; the
 * pipeline keeps going and the failure is recorded in `scrape_runs`.
 */

const MAX_SCRAPES_PER_STORE = 5;

interface JsonLdProduct {
  name?: string;
  sku?: string;
  productID?: string;
  image?: string | string[] | { url?: string } | Array<{ url?: string }>;
  offers?: {
    price?: string | number;
    lowPrice?: string | number;
    priceCurrency?: string;
    availability?: string;
    url?: string;
  } | Array<{
    price?: string | number;
    lowPrice?: string | number;
    priceCurrency?: string;
    availability?: string;
    url?: string;
  }>;
  brand?: string | { name?: string } | Array<{ name?: string }>;
  "@type"?: string | string[];
}

function collectJsonLd($: CheerioAPI): unknown[] {
  const payloads: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;
    try {
      const parsedUnknown = JSON.parse(raw) as unknown;
      if (Array.isArray(parsedUnknown)) payloads.push(...parsedUnknown);
      else payloads.push(parsedUnknown);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });
  return payloads;
}

function flattenJsonLd(nodes: unknown[], output: JsonLdProduct[] = []): JsonLdProduct[] {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record["@graph"])) flattenJsonLd(record["@graph"] as unknown[], output);

    const type = record["@type"];
    const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
    if (types.some((entry) => entry.toLowerCase() === "product")) {
      output.push(record as JsonLdProduct);
    }
    if (types.some((entry) => entry.toLowerCase() === "itemlist")) {
      const elements = record.itemListElement;
      if (Array.isArray(elements)) {
        flattenJsonLd(
          elements.map((element) =>
            element && typeof element === "object" && "item" in element
              ? (element as { item: unknown }).item
              : element
          ),
          output
        );
      }
    }
  }
  return output;
}

function jsonLdImage(image: JsonLdProduct["image"]): string | null {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    const first = image[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof first.url === "string") return first.url;
    return null;
  }
  if (typeof image === "object" && typeof (image as { url?: string }).url === "string") {
    return (image as { url: string }).url;
  }
  return null;
}

function jsonLdBrand(brand: JsonLdProduct["brand"]): string | null {
  if (!brand) return null;
  if (typeof brand === "string") return brand;
  if (Array.isArray(brand)) return brand[0]?.name ?? null;
  return brand.name ?? null;
}

function absoluteUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function sameHost(url: string, base: string): boolean {
  try {
    return new URL(url).host === new URL(base).host;
  } catch {
    return false;
  }
}

function fromJsonLd(
  products: JsonLdProduct[],
  store: PanamaStoreConfig,
  base: string
): RawScrapedItem[] {
  const items: RawScrapedItem[] = [];

  for (const product of products) {
    const title = product.name?.trim();
    if (!title || title.length < 4) continue;

    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const priceCents =
      parsePriceToCents(offers?.price ?? null) ?? parsePriceToCents(offers?.lowPrice ?? null);
    if (!priceCents) continue;

    const url = absoluteUrl(offers?.url ?? null, base) ?? base;
    const availability = (offers?.availability ?? "InStock").toLowerCase();
    const inStock = !/(outofstock|soldout|discontinued|preorder)/.test(availability);

    const item: RawScrapedItem = {
      storeSlug: store.slug,
      externalId: product.sku ?? product.productID ?? url,
      title,
      brand: jsonLdBrand(product.brand),
      sku: product.sku ?? null,
      productType: null,
      priceCents,
      originalPriceCents: null,
      currency: "USD",
      inStock,
      url,
      imageUrl: jsonLdImage(product.image),
      rawSpecs: { platform: "json-ld" },
    };

    if (isRelevantElectronicsProduct(item) && sameHost(item.url, base)) items.push(item);
  }

  return items;
}

function fromThemedMarkup(
  $: CheerioAPI,
  store: PanamaStoreConfig,
  base: string,
  limit: number
): RawScrapedItem[] {
  const items: RawScrapedItem[] = [];
  const cards = $(
    "li.product, div.product, .product-item, .product-small, .product-card, article.product"
  );

  cards.each((_, element) => {
    if (items.length >= limit) return false;
    const node = $(element);

    let title = "";
    for (const selector of [
      ".woocommerce-loop-product__title",
      ".product-item-link",
      ".product-title",
      "h2",
      "h3",
      "a[title]",
    ]) {
      const candidate = node.find(selector).first().text().replace(/\s+/g, " ").trim();
      if (candidate.length > 0) {
        title = candidate;
        break;
      }
    }

    const link =
      node.find("a.product-item-link").attr("href") ??
      node.find("a.woocommerce-LoopProduct-link").attr("href") ??
      node.find("a[itemprop='url']").attr("href") ??
      node.find("a").first().attr("href");
    const url = absoluteUrl(link, base);

    const image =
      node.find("img.product-image-photo").attr("src") ??
      node.find("img").first().attr("data-src") ??
      node.find("img").first().attr("src");

    const priceAttr =
      node.find("[data-price-type='finalPrice']").attr("data-price-amount") ??
      node.find(".price-wrapper[data-price-amount]").first().attr("data-price-amount") ??
      null;
    const priceText =
      node.find(".price ins .amount").first().text() ||
      node.find(".price .amount").first().text() ||
      node.find(".price").first().text() ||
      node.text();
    const priceCents = parsePriceToCents(priceAttr) ?? findUsdPriceCents(priceText);

    const oldPriceCents =
      parsePriceToCents(node.find("[data-price-type='oldPrice']").attr("data-price-amount") ?? null) ??
      parsePriceToCents(node.find("del .amount").first().text() || null);

    if (!title || title.length < 4 || !priceCents || !url) return;

    const externalId =
      node.find("[data-product-id]").attr("data-product-id") ??
      node.find("[data-product_sku]").attr("data-product_sku") ??
      url;

    const item: RawScrapedItem = {
      storeSlug: store.slug,
      externalId,
      title,
      sku: node.find("[data-product_sku]").attr("data-product_sku") ?? null,
      productType: node.find("[data-product_type]").attr("data-product_type") ?? null,
      priceCents,
      originalPriceCents: oldPriceCents && oldPriceCents > priceCents ? oldPriceCents : null,
      currency: "USD",
      inStock: !/out-of-stock|agotado|sin-stock/i.test(node.attr("class") ?? ""),
      url,
      imageUrl: absoluteUrl(image, base),
      rawSpecs: { platform: "html-markup" },
    };

    if (isRelevantElectronicsProduct(item) && sameHost(item.url, base)) items.push(item);
  });

  return items;
}

/** Last resort: anchors that contain an image plus a nearby price. */
function fromLinkHeuristic(
  $: CheerioAPI,
  store: PanamaStoreConfig,
  base: string,
  limit: number
): RawScrapedItem[] {
  const items: RawScrapedItem[] = [];
  const seen = new Set<string>();

  $("a").each((_, element) => {
    if (items.length >= limit) return false;
    const node = $(element);
    const href = absoluteUrl(node.attr("href"), base);
    if (!href || !sameHost(href, base) || seen.has(href)) return;

    const hasImage = node.find("img").length > 0;
    if (!hasImage) return;

    const title =
      node.attr("title")?.trim() ||
      node.find("img").attr("alt")?.trim() ||
      node.text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 8) return;

    const container = node.closest("li, article, div");
    const priceCents = findUsdPriceCents(container.text().slice(0, 400));
    if (!priceCents) return;

    const image = absoluteUrl(
      node.find("img").first().attr("src") ?? node.find("img").first().attr("data-src"),
      base
    );

    const item: RawScrapedItem = {
      storeSlug: store.slug,
      externalId: href,
      title,
      sku: null,
      productType: null,
      priceCents,
      originalPriceCents: null,
      currency: "USD",
      inStock: true,
      url: href,
      imageUrl: image,
      rawSpecs: { platform: "link-heuristic" },
    };

    if (!isRelevantElectronicsProduct(item)) return;
    seen.add(href);
    items.push(item);
  });

  return items;
}

/** Parses product data out of any rendered store HTML. */
export function parseGenericStoreHtml(
  html: string,
  store: PanamaStoreConfig,
  limit: number
): RawScrapedItem[] {
  if (!html || html.length < 200) return [];
  const base = store.baseUrl.replace(/\/+$/, "");
  const $ = load(html);

  const jsonLd = fromJsonLd(flattenJsonLd(collectJsonLd($)), store, base);
  if (jsonLd.length > 0) return dedupeItems(jsonLd).slice(0, limit);

  const themed = fromThemedMarkup($, store, base, limit);
  if (themed.length > 0) return dedupeItems(themed).slice(0, limit);

  return dedupeItems(fromLinkHeuristic($, store, base, limit)).slice(0, limit);
}

function candidateCategoryLinks(links: string[], base: string): string[] {
  const keywords =
    /(categor|producto|tienda|shop|collection|linea-blanca|televisor|audio|comput|electrodomest|catalogo)/i;
  const skip = /(carrito|cart|checkout|login|cuenta|blog|contacto|nosotros|terminos|privacidad|faq)/i;
  return links
    .filter((link) => sameHost(link, base) && keywords.test(link) && !skip.test(link))
    .filter((link) => !/\.(jpg|jpeg|png|webp|pdf|css|js)$/i.test(link))
    .slice(0, 3);
}

export function createFirecrawlStoreAdapter(
  store: PanamaStoreConfig,
  options: { alternateUrls?: string[] } = {}
): StoreAdapter {
  return {
    slug: store.slug,
    engine: "firecrawl",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const client = getFirecrawlClient({ verbose: false });
      const bases = [store.baseUrl, ...(options.alternateUrls ?? [])].map((url) =>
        url.replace(/\/+$/, "")
      );

      let scrapes = 0;
      const collected: RawScrapedItem[] = [];
      const perBaseBudget = Math.max(1, Math.floor(MAX_SCRAPES_PER_STORE / bases.length));

      for (const base of bases) {
        if (collected.length >= context.maxPerStore) break;
        const storeWithBase: PanamaStoreConfig = { ...store, baseUrl: base };
        let baseScrapes = 0;

        for (const path of store.scrapePaths.slice(0, 3)) {
          if (baseScrapes >= perBaseBudget || scrapes >= MAX_SCRAPES_PER_STORE) break;
          const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
          scrapes += 1;
          baseScrapes += 1;

          let html: string | null = null;
          if (context.useFirecrawl) {
            const result = await client.tryScrape(url);
            html = result?.html ?? result?.markdown ?? null;
          } else {
            try {
              html = await fetchText(url, { timeoutMs: 25_000, retries: 1 });
            } catch (error) {
              context.log(`  ${store.slug}${path} HTTP falló: ${(error as Error).message}`);
            }
          }

          if (!html) {
            context.log(`  ${store.slug}${path}: sin contenido`);
            continue;
          }

          const items = parseGenericStoreHtml(html, storeWithBase, context.maxPerStore);
          collected.push(...items);

          // A page with neither a price nor schema.org product data is not a
          // catalog page (quote-only/landing pages). Stop burning Firecrawl
          // credits on sibling routes of the same host.
          const hasCommerceSignals =
            /(?:\$|B\/\.)\s?\d/.test(html) || /"@type"\s*:\s*"(?:Product|ItemList|Offer)"/.test(html);
          if (items.length === 0 && !hasCommerceSignals) {
            context.log(`  ${store.slug}${path}: sin señales de catálogo (sin precios), se omiten más rutas`);
            break;
          }

          if (items.length === 0 && baseScrapes < perBaseBudget) {
            // Home page: follow up to three promising category links.
            const links = (html.match(/href="([^"]+)"/g) ?? [])
              .map((match) => match.slice(6, -1))
              .map((href) => absoluteUrl(href, base))
              .filter((value): value is string => Boolean(value));

            for (const link of candidateCategoryLinks(links, base)) {
              if (baseScrapes >= perBaseBudget) break;
              scrapes += 1;
              baseScrapes += 1;
              let nextHtml: string | null = null;
              if (context.useFirecrawl) {
                nextHtml = (await client.tryScrape(link))?.html ?? null;
              } else {
                try {
                  nextHtml = await fetchText(link, { timeoutMs: 25_000, retries: 0 });
                } catch {
                  nextHtml = null;
                }
              }
              if (!nextHtml) continue;
              const nextItems = parseGenericStoreHtml(
                nextHtml,
                storeWithBase,
                context.maxPerStore
              );
              collected.push(...nextItems);
              if (collected.length >= context.maxPerStore) break;
            }
          }

          if (collected.length >= context.maxPerStore) break;
        }

        if (collected.length > 0) break;
      }

      const unique = dedupeItems(collected).slice(0, context.maxPerStore);
      context.log(`  ${store.slug}: ${unique.length} productos vía Firecrawl (${scrapes} scrapes)`);
      return unique;
    },
  };
}
