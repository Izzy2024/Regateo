#!/usr/bin/env bun
/**
 * Script interno de operación del Radar de Precios — RegateoApp.
 *
 * Uso interno (terminal local, VPS, Render Cron o GitHub Actions):
 *   bun run scrape:radar                        # Catálogo completo (hasta 6,000 por tienda) + limpia caché API
 *   bun run scrape:radar --stores=panafoto      # Solo una o varias tiendas
 *   bun run scrape:radar --full                 # Sin techo práctico (hasta 20,000 por tienda)
 *   bun run scrape:radar --quick                # Barrido rápido de verificación (250 por tienda)
 *   bun run scrape:radar --no-enrich            # Omite búsqueda cruzada extra
 *
 * Este script NUNCA se expone a visitantes públicos de la web.
 */
import { sql, sqlClient, db } from "@regateo/db";
import { runScrapePipeline } from "@regateo/scraper";

function parseArgs(argv: string[]) {
  let stores: string[] | undefined;
  let maxPerStore = 6000;
  let useFirecrawl = true;
  let enrich = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--full") {
      maxPerStore = 20000;
    } else if (arg === "--quick") {
      maxPerStore = 250;
    } else if (arg === "--no-firecrawl") {
      useFirecrawl = false;
    } else if (arg === "--no-enrich") {
      enrich = false;
    } else if (arg.startsWith("--stores=")) {
      stores = arg
        .slice("--stores=".length)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === "--stores" && argv[i + 1]) {
      stores = argv[++i]!
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg.startsWith("--max=")) {
      const n = Number.parseInt(arg.slice("--max=".length), 10);
      if (Number.isFinite(n) && n > 0) maxPerStore = n;
    }
  }

  return { stores, maxPerStore, useFirecrawl, enrich };
}

async function invalidateApiCache() {
  const apiUrl = (process.env.API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return;

  try {
    const res = await fetch(`${apiUrl}/api/cron/invalidate-cache`, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log(`🧹 Caché de la API refrescada automáticamente (${apiUrl})`);
    }
  } catch {
    console.log(`ℹ️  API no accesible en ${apiUrl} (la caché se refrescará al iniciar la API)`);
  }
}

async function printRadarSnapshot() {
  const storeRows = await db.execute(sql`
    SELECT s.name, count(sl.id)::int AS listings, s.last_scraped_at
    FROM stores s
    LEFT JOIN store_listings sl ON sl.store_id = s.id
    GROUP BY s.id, s.name, s.last_scraped_at
    ORDER BY listings DESC
  `);
  const totals = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM products) AS total_products,
      (SELECT count(*)::int FROM store_listings) AS total_listings,
      (SELECT count(*)::int FROM (
        SELECT product_id FROM store_listings GROUP BY product_id HAVING count(DISTINCT store_id) >= 2
      ) sub) AS multi_store_products
  `);

  console.log("\n📊 Estado actual del Radar de Precios (PostgreSQL):");
  console.table(storeRows);
  const t = totals[0] as
    | { total_products: number; total_listings: number; multi_store_products: number }
    | undefined;
  if (t) {
    console.log(
      `✅ Total: ${t.total_products} productos únicos · ${t.total_listings} listings · ${t.multi_store_products} comparables en 2+ tiendas\n`
    );
  }
}

const started = Date.now();
const opts = parseArgs(process.argv.slice(2));

console.log("🔒 RegateoApp — Ejecución INTERNA del Radar de Precios");
console.log(
  `   Tiendas: ${opts.stores ? opts.stores.join(", ") : "TODAS las activas"} · maxPerStore: ${opts.maxPerStore} · enrich: ${opts.enrich ? "sí" : "no"}`
);

try {
  await runScrapePipeline({
    stores: opts.stores,
    maxPerStore: opts.maxPerStore,
    useFirecrawl: opts.useFirecrawl,
    enrich: opts.enrich,
  });

  await invalidateApiCache();
  await printRadarSnapshot();
  console.log(`⏱️  Tiempo total: ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}
