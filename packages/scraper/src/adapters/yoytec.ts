import { load } from "cheerio";
import type { PanamaStoreConfig } from "@regateo/shared";
import { getFirecrawlClient } from "../firecrawl-client";
import { BROWSER_HEADERS, fetchText, mapWithConcurrency } from "../http";
import { dedupeItems, isRelevantElectronicsProduct, parsePriceToCents } from "../matching";
import type { AdapterContext, RawScrapedItem, StoreAdapter } from "../types";

/**
 * Yoytec (`https://www.yoytec.com`) — Odoo eCommerce.
 *
 * Odoo renders the whole product grid server-side, so plain HTTP + Cheerio is
 * enough (no Firecrawl credits). Each card is a `form.oe_product_cart` with
 * schema.org microdata (`itemprop=name/url/price/priceCurrency`) plus
 * `oe_currency_value` and the real stock badge. Firecrawl is only used as a
 * fallback when the store starts blocking plain requests.
 */

/** Categories worth indexing, highest priority first. */
const PRIORITY_KEYWORDS = [
  "portátiles",
  "portatiles",
  "computadoras",
  "computadoras de escritorio",
  "monitores",
  "ratones",
  "teclados",
  "periféricos",
  "perifericos",
  "componentes",
  "tarjetas de video",
  "procesadores",
  "tarjetas madre",
  "memorias",
  "almacenamientos",
  "auriculares",
  "bocinas",
  "impresoras",
  "televisores",
  "celulares",
  "consolas",
  "enrutador",
  "ups",
];

const MAX_CATEGORIES = 12;
/** Above this budget /shop is paged end-to-end (≈50 pages today). */
const FULL_CATALOG_THRESHOLD = 1000;
const FULL_PAGE_PAUSE_MS = 300;
const FULL_CONCURRENCY = 2;
/** Safety cap: /shop has ~50 pages; never walk an infinite 404 pager. */
const MAX_FULL_PAGES = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const SHOP_PAGE_SIZE = 48;

interface YoytecCategory {
  id: string;
  name: string;
  score: number;
}

/** Stable short id for cards whose DOM exposes no numeric product id. */
function shortId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `oa-${hash.toString(36)}`;
}

function absolute(store: PanamaStoreConfig, href: string | undefined | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, store.baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Accessory shelves ride on the same keywords ("Bases para portátiles"). */
const ACCESSORY_PENALTY =
  /(bases|cargadores|cables|fundas|maletines|adaptadores|herramientas|suministros|tintas|t[oó]ner|licencias|servicios|garant[ií]as|domicilios|mobiliario|repuestos|pastas|ventiladores)/i;

function categoryScore(name: string): number {
  const normalized = normalizeName(name);
  const index = PRIORITY_KEYWORDS.findIndex((keyword) =>
    normalized.includes(normalizeName(keyword))
  );
  if (index === -1) return -1;

  let score = (PRIORITY_KEYWORDS.length - index) * 10;
  if (ACCESSORY_PENALTY.test(name)) score -= 60;
  // "Portátiles" should beat "Bases para portátiles".
  if (normalizeName(name).startsWith(normalizeName(PRIORITY_KEYWORDS[index] ?? ""))) score += 5;
  score -= Math.min(5, Math.floor(name.length / 12));
  return score;
}

/** Discovers `/shop/category/<id>` links with their display names. */
/**
 * Category shelves overlap heavily ("Portátiles", "Computadoras", "Computadoras /
 * Tabletas"…). Grouping them keeps the budget spread across families so mice,
 * keyboards, monitors and audio also get scraped instead of 7 laptop shelves.
 */
function categoryFamily(name: string): string {
  const normalized = normalizeName(name);
  const families: Array<[string, RegExp]> = [
    ["portatiles", /portatil|laptop/],
    ["computadoras", /computadora|escritorio|servidor|estacion|todo en uno|tableta/],
    ["monitores", /monitor|pantalla/],
    ["ratones", /rat[oó]n|mouse/],
    ["teclados", /teclado|keyboard/],
    ["perifericos", /perif[eé]rico|auricular|bocina|consola|mando|webcam|c[aá]mara/],
    ["componentes", /componente|tarjeta|procesador|memoria|almacenamiento|fuente|gabinete|enfriamiento|pasta|ventilador/],
    ["impresoras", /impresora|t[oó]ner|tinta|plotter|esc[aá]ner/],
    ["televisores", /televisor/],
    ["celulares", /celular|tablet/],
    ["redes", /red|enrutador|conmutador|telefon/],
    ["energia", /ups|regulador|bater/],
  ];
  for (const [family, pattern] of families) {
    if (pattern.test(normalized)) return family;
  }
  return "otros";
}

export function parseYoytecCategories(html: string): YoytecCategory[] {
  const $ = load(html);
  const found = new Map<string, YoytecCategory>();

  $('a[href*="/shop/category/"]').each((_, element) => {
    const node = $(element);
    const href = node.attr("href") ?? "";
    const id = href.match(/\/shop\/category\/(\d+)/)?.[1];
    if (!id) return;

    const name = (node.find("img").attr("alt") ?? node.text()).replace(/\s+/g, " ").trim();
    if (!name) return;

    const score = categoryScore(name);
    const current = found.get(id);
    if (!current || score > current.score) found.set(id, { id, name, score });
  });

  return [...found.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Parses an Odoo `/shop` (or category) page product grid. */
export function parseYoytecHtml(
  html: string,
  store: PanamaStoreConfig,
  limit: number
): RawScrapedItem[] {
  if (!html || html.length < 200) return [];
  const $ = load(html);
  const items: RawScrapedItem[] = [];

  $("form.oe_product_cart, form.oe_product").each((_, element) => {
    if (items.length >= limit) return false;
    const node = $(element);

    const title =
      node.find('a[itemprop="name"]').first().attr("content")?.trim() ??
      node.find('a[itemprop="name"]').first().text().replace(/\s+/g, " ").trim() ??
      node.attr("aria-label")?.replace(/^\[[^\]]+\]\s*/, "").trim() ??
      "";
    if (title.length < 3) return;

    const href =
      node.find('a[itemprop="url"]').first().attr("href") ??
      node.find('a[href^="/shop/"]').first().attr("href");
    const url = absolute(store, href);
    if (!url) return;

    // `store_listings.external_id` is varchar(160): never store the full URL.
    const productId = (
      node.find('input[name="product_id"]').first().attr("value")?.trim() ??
      node.find('input[name="product_template_id"]').first().attr("value")?.trim() ??
      url.match(/-(\d{1,12})\/?(?:[?#].*)?$/)?.[1] ??
      shortId(url)
    ).slice(0, 160);

    const imageEl = node.find("img.oe_product_image_img").first();
    const imageUrl =
      absolute(store, imageEl.attr("src")) ?? absolute(store, imageEl.attr("data-src"));

    const priceCents =
      parsePriceToCents(
        node.find("span.oe_currency_value").first().text() ||
          node.find('span[itemprop="price"]').first().text() ||
          node.find(".product_price").first().text()
      ) ?? null;
    if (!priceCents) return;

    const oldPriceCents = parsePriceToCents(
      node.find("del").first().text() || node.find(".text-decoration-line-through").first().text()
    );

    const skuSource = imageEl.attr("alt") ?? node.attr("aria-label") ?? "";
    const sku = skuSource.match(/^\[([^\]]{2,40})\]/)?.[1] ?? null;

    const productType = node.find(".categ-name").first().text().replace(/\s+/g, " ").trim() || null;

    const inStock =
      node.find(".out-stock-badge").length > 0
        ? false
        : node.find(".in-stock-badge").length > 0
          ? true
          : !/agotado|out of stock|sin existencias/i.test(node.text());

    const mapped: RawScrapedItem = {
      storeSlug: store.slug,
      externalId: String(productId),
      // Yoytec SKUs are internal codes (`CBL-ENC-008`, `COM-MJK-G15`), never a
      // manufacturer model; title model codes are used instead.
      trustSkuModel: false,
      title,
      sku,
      productType,
      priceCents,
      originalPriceCents: oldPriceCents && oldPriceCents > priceCents ? oldPriceCents : null,
      currency: "USD",
      inStock,
      url,
      imageUrl,
      rawSpecs: {
        platform: "odoo",
        productId,
        templateId: node.find('input[name="product_template_id"]').first().attr("value") ?? null,
        storeCategory: productType,
      },
    };

    if (isRelevantElectronicsProduct(mapped)) items.push(mapped);
  });

  // The same Odoo product can be listed in several categories with different
  // template ids, so collapse by SKU first and by external id afterwards.
  const byIdentity = new Map<string, RawScrapedItem>();
  for (const item of dedupeItems(items)) {
    const key = item.sku ?? item.externalId;
    if (!byIdentity.has(key)) byIdentity.set(key, item);
  }

  return [...byIdentity.values()].slice(0, limit);
}

async function fetchYoytecPage(
  store: PanamaStoreConfig,
  url: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    return await fetchText(url, {
      timeoutMs: 30_000,
      retries: 1,
      headers: BROWSER_HEADERS,
      signal,
    });
  } catch {
    return null;
  }
}

/**
 * Full-catalog mode: walks `/shop?page=N` (48 cards/page) two pages at a time
 * with a short pause, until Odoo returns no more products or the budget is met.
 */
async function pageYoytecShop(
  store: PanamaStoreConfig,
  base: string,
  maxItems: number,
  context: AdapterContext
): Promise<RawScrapedItem[]> {
  const collected: RawScrapedItem[] = [];
  const seen = new Set<string>();
  let page = 1;
  let emptyPages = 0;
  let noNewRounds = 0;

  while (collected.length < maxItems && page <= MAX_FULL_PAGES && !context.signal?.aborted) {
    const pages = Array.from({ length: FULL_CONCURRENCY }, (_, index) => page + index);
    const results = await Promise.all(
      pages.map(async (currentPage) => {
        const html = await fetchYoytecPage(store, `${base}/shop?page=${currentPage}`, context.signal);
        if (!html) return null;
        return {
          // Real product forms only: the theme CSS/JS also contains the class name.
          rawCards: (html.match(/<form[^>]*oe_product_cart/gi) ?? []).length,
          parsed: parseYoytecHtml(html, store, SHOP_PAGE_SIZE),
        };
      })
    );

    let newItems = 0;
    let rawCards = 0;
    for (const result of results) {
      if (!result) continue;
      rawCards += result.rawCards;
      for (const item of result.parsed) {
        if (collected.length >= maxItems) break;
        const key = item.sku ?? item.externalId;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(item);
        newItems += 1;
      }
    }

    page += FULL_CONCURRENCY;
    if (rawCards === 0) {
      emptyPages += 1;
    } else {
      emptyPages = 0;
    }
    if (newItems === 0) noNewRounds += 1;
    else noNewRounds = 0;

    // Stop when both probed pages are empty, or when Odoo keeps repeating the
    // same page (no new unique products for 5 rounds).
    if (emptyPages >= FULL_CONCURRENCY || noNewRounds >= 5) {
      context.log(`  yoytec: fin del catálogo en ~${page - FULL_CONCURRENCY} páginas`);
      break;
    }

    if (page % 20 === 1) {
      context.log(`  yoytec: ${page - 1} páginas de /shop · ${collected.length} relevantes`);
    }
    await sleep(FULL_PAGE_PAUSE_MS);
  }

  return collected.slice(0, maxItems);
}

function roundRobin(pools: RawScrapedItem[][], max: number): RawScrapedItem[] {
  const merged: RawScrapedItem[] = [];
  const seen = new Set<string>();
  const queues = pools.map((pool) => pool.slice());
  let added = true;

  while (added && merged.length < max) {
    added = false;
    for (const queue of queues) {
      if (merged.length >= max) break;
      const next = queue.shift();
      if (!next) continue;
      added = true;
      if (seen.has(next.externalId)) continue;
      seen.add(next.externalId);
      merged.push(next);
    }
  }

  return merged;
}

export function createYoytecAdapter(store: PanamaStoreConfig): StoreAdapter {
  return {
    slug: store.slug,
    engine: "http-cheerio",

    async scrape(context: AdapterContext): Promise<RawScrapedItem[]> {
      const base = store.baseUrl.replace(/\/+$/, "");
      const shopUrl = `${base}/shop`;

      // ---- Full catalog mode: page /shop end-to-end. -----------------------
      if (context.maxPerStore > FULL_CATALOG_THRESHOLD) {
        const full = await pageYoytecShop(store, base, context.maxPerStore, context);
        const unique = dedupeItems(full).slice(0, context.maxPerStore);
        context.log(`  yoytec: ${unique.length} productos relevantes (catálogo completo /shop)`);
        return unique;
      }

      let shopHtml = await fetchYoytecPage(store, shopUrl);
      let items: RawScrapedItem[] = [];

      if (shopHtml) {
        const ranked = parseYoytecCategories(shopHtml).filter((category) => category.score > 0);
        const categories: YoytecCategory[] = [];
        const familyCounts = new Map<string, number>();
        for (const category of ranked) {
          if (categories.length >= MAX_CATEGORIES) break;
          const family = categoryFamily(category.name);
          const used = familyCounts.get(family) ?? 0;
          const limit = family === "computadoras" || family === "portatiles" ? 2 : 2;
          if (used >= limit) continue;
          categories.push(category);
          familyCounts.set(family, used + 1);
        }

        if (categories.length > 0) {
          const pools = await mapWithConcurrency(categories, 3, async (category) => {
            const collected: RawScrapedItem[] = [];
            const pages = Math.max(
              2,
              Math.ceil(context.maxPerStore / categories.length / SHOP_PAGE_SIZE) + 1
            );
            for (let page = 1; page <= pages; page += 1) {
              if (context.signal?.aborted) break;
              const url = `${base}/shop/category/${category.id}?page=${page}`;
              const html = await fetchYoytecPage(store, url, context.signal);
              if (!html) break;
              const parsed = parseYoytecHtml(html, store, SHOP_PAGE_SIZE);
              if (parsed.length === 0) break;
              collected.push(...parsed);
            }
            return collected;
          });

          items = roundRobin(pools, context.maxPerStore);
          context.log(
            `  yoytec: ${categories.length} categorías (${categories
              .slice(0, 4)
              .map((category) => category.name)
              .join(", ")}…)`
          );
        }

        // Fallback: browse the general shop pagination.
        if (items.length < Math.min(24, context.maxPerStore)) {
          const pools: RawScrapedItem[][] = [];
          const extraPages = Math.max(1, Math.ceil(context.maxPerStore / SHOP_PAGE_SIZE));
          for (let page = 1; page <= extraPages; page += 1) {
            const html =
              page === 1 ? shopHtml : await fetchYoytecPage(store, `${shopUrl}?page=${page}`);
            if (!html) break;
            pools.push(parseYoytecHtml(html, store, SHOP_PAGE_SIZE));
          }
          items = roundRobin([items, ...pools], context.maxPerStore);
        }
      }

      if (items.length === 0) {
        // Store blocked plain HTTP: let Firecrawl render the grid.
        const client = getFirecrawlClient({ verbose: false });
        if (context.useFirecrawl) {
          const fallbackUrls = [shopUrl, `${shopUrl}?page=2`];
          for (const url of fallbackUrls) {
            const result = await client.tryScrape(url);
            const html = result?.html ?? result?.markdown ?? null;
            if (!html) continue;
            items.push(...parseYoytecHtml(html, store, context.maxPerStore));
            if (items.length >= context.maxPerStore) break;
          }
        }
      }

      const unique = dedupeItems(items).slice(0, context.maxPerStore);
      context.log(`  yoytec: ${unique.length} productos relevantes de Odoo`);
      return unique;
    },
  };
}
