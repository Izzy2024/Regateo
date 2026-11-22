#!/usr/bin/env bun
import { sqlClient } from "@regateo/db";
import { PANAMA_STORES } from "@regateo/shared";
import { getFirecrawlClient } from "./firecrawl-client";
import { runScrapePipeline, type ScrapeRunSummary } from "./pipeline";

/**
 * `bun run scrape`
 *
 *   --stores=panafoto,titan,multimax,rodelag,yoytec,ptytec,photura,doitcenter
 *   --max=35            productos máximos por tienda (1..200)
 *   --no-firecrawl      usa únicamente Shopify JSON / GraphQL / HTTP directo
 *   --json              imprime el resumen como JSON (para CI)
 */

interface CliOptions {
  stores?: string[];
  maxPerStore?: number;
  useFirecrawl: boolean;
  enrich: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { useFirecrawl: true, enrich: true, json: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--full") {
      // Catálogo completo: sin tope práctico (el máximo duro es 20.000).
      options.maxPerStore = 20_000;
      continue;
    }
    if (arg === "--no-firecrawl") {
      options.useFirecrawl = false;
      continue;
    }
    if (arg === "--no-enrich") {
      options.enrich = false;
      continue;
    }
    if (arg === "--firecrawl") {
      options.useFirecrawl = true;
      continue;
    }
    if (arg.startsWith("--stores")) {
      const inline = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[(index += 1)];
      if (inline) {
        options.stores = inline
          .split(",")
          .map((slug) => slug.trim().toLowerCase())
          .filter(Boolean);
      }
      continue;
    }
    if (arg.startsWith("--max")) {
      const inline = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[(index += 1)];
      const parsed = Number.parseInt(String(inline ?? ""), 10);
      if (Number.isFinite(parsed)) options.maxPerStore = parsed;
      continue;
    }
    if (!arg.startsWith("-")) {
      // Positional store list is accepted as a convenience: `bun run scrape multimax`
      options.stores = arg
        .split(",")
        .map((slug) => slug.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
🛒  RegateoApp Scraper — productos reales de electrónica en Panamá

Uso:
  bun run scrape [opciones]

Opciones:
  --stores=a,b,c   Tiendas a scrapear (${PANAMA_STORES.map((store) => store.slug).join(", ")})
  --max=35         Máximo de productos por tienda (default 5000, máx 20000)
  --full           Catálogo completo (= --max=20000)
  --no-firecrawl   Sin Firecrawl (solo Shopify JSON / Magento GraphQL / HTTP)
  --no-enrich      Omite la búsqueda cruzada por modelo entre tiendas
  --json           Salida JSON para CI
  -h, --help       Esta ayuda

Ejemplos:
  bun run scrape                          # catálogo completo (max 5000/tienda)
  bun run scrape --full                   # sin tope (max 20000/tienda)
  bun run scrape --stores=multimax,panafoto --max=40
  bun run scrape --no-firecrawl --json
`);
}

function printSummaryTable(summaries: ScrapeRunSummary[]): void {
  const rows = summaries.map((summary) => ({
    Tienda: summary.storeSlug,
    Motor: summary.engine,
    Estado: summary.status === "completed" ? "OK" : "FALLÓ",
    Encontrados: String(summary.itemsFound),
    Guardados: String(summary.itemsUpserted),
    Error: summary.errorMessage ? summary.errorMessage.slice(0, 60) : "",
  }));

  console.table(rows);

  const totals = summaries.reduce(
    (accumulator, summary) => {
      accumulator.found += summary.itemsFound;
      accumulator.saved += summary.itemsUpserted;
      return accumulator;
    },
    { found: 0, saved: 0 }
  );

  console.log(
    `\n✅ ${summaries.filter((summary) => summary.status === "completed").length}/${summaries.length} tiendas OK · ${totals.saved} productos guardados de ${totals.found} encontrados`
  );
  console.log("   Base de datos: regateoapp_dev · tablas products, store_listings, price_history, scrape_runs");
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  const status = getFirecrawlClient({ verbose: false }).status();
  if (!options.json) {
    console.log(
      `🔥  Firecrawl: ${status.mode}${status.sdkConfigured ? " (SDK)" : status.cliAvailable ? " (CLI autenticado)" : " (sin credenciales, se usará HTTP directo)"}`
    );
  }

  const summaries = await runScrapePipeline({
    stores: options.stores,
    maxPerStore: options.maxPerStore,
    useFirecrawl: options.useFirecrawl,
    enrich: options.enrich,
    quiet: options.json,
  });

  if (options.json) {
    console.log(JSON.stringify({ summaries }, null, 2));
  } else {
    console.log("");
    printSummaryTable(summaries);
  }

  const completed = summaries.filter((summary) => summary.status === "completed").length;
  return completed > 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`\n❌ Scrape falló: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}

process.exit(exitCode);
