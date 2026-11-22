#!/usr/bin/env bun
import { sqlClient } from "@regateo/db";
import { PANAMA_STORES } from "@regateo/shared";
import { runScrapePipeline } from "./pipeline";
import {
  DEFAULT_SCRAPE_INTERVAL_DAYS,
  formatPanama,
  getScrapeIntervalDays,
  nextScrapeDate,
} from "./scheduler-config";

/**
 * `bun run scrape:schedule`
 *
 * Daemon for a VPS / Render Worker: runs the pipeline every `SCRAPE_INTERVAL_DAYS`
 * days (default 3, validated 1..7) at 03:00 hora de Panamá (08:00 UTC).
 *
 *   --run-now   ejecuta inmediatamente y luego entra en modo daemon
 *   --once      ejecuta una sola vez y termina (ideal para cron externo)
 *   --help
 */

interface SchedulerOptions {
  runNow: boolean;
  once: boolean;
  help: boolean;
  stores?: string[];
  maxPerStore?: number;
  useFirecrawl: boolean;
}

function parseArgs(argv: string[]): SchedulerOptions {
  const options: SchedulerOptions = {
    runNow: false,
    once: false,
    help: false,
    useFirecrawl: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--run-now" || arg === "--now") options.runNow = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--no-firecrawl") options.useFirecrawl = false;
    else if (arg.startsWith("--stores")) {
      const inline = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[(index += 1)];
      if (inline) {
        options.stores = inline
          .split(",")
          .map((slug) => slug.trim().toLowerCase())
          .filter(Boolean);
      }
    } else if (arg.startsWith("--max")) {
      const inline = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[(index += 1)];
      const parsed = Number.parseInt(String(inline ?? ""), 10);
      if (Number.isFinite(parsed)) options.maxPerStore = parsed;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
⏰  RegateoApp Scraper Scheduler

Frecuencia: SCRAPE_INTERVAL_DAYS=${process.env.SCRAPE_INTERVAL_DAYS ?? DEFAULT_SCRAPE_INTERVAL_DAYS} (válido 1..7 días)
Horario: 03:00 hora de Panamá (08:00 UTC)
Tiendas: ${PANAMA_STORES.map((store) => store.slug).join(", ")}

Uso:
  bun run scrape:schedule               # daemon (próxima corrida programada)
  bun run scrape:schedule --run-now     # corre ya y sigue como daemon
  bun run scrape:schedule --once        # una sola corrida (para cron/VPS)

Opciones:
  --stores=a,b    limita las tiendas
  --max=35        máximo por tienda
  --no-firecrawl  sin Firecrawl
`);
}

function sleepUntil(target: Date): Promise<void> {
  const delay = Math.max(0, target.getTime() - Date.now());
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

async function runOnce(options: SchedulerOptions): Promise<boolean> {
  console.log(`\n🕒  ${new Date().toISOString()} · iniciando corrida programada`);
  try {
    const summaries = await runScrapePipeline({
      stores: options.stores,
      maxPerStore: options.maxPerStore,
      useFirecrawl: options.useFirecrawl,
    });
    const completed = summaries.filter((summary) => summary.status === "completed").length;
    const saved = summaries.reduce((total, summary) => total + summary.itemsUpserted, 0);
    console.log(`✅  Corrida finalizada: ${completed}/${summaries.length} tiendas OK · ${saved} productos`);
    return completed > 0;
  } catch (error) {
    console.error(`❌  Corrida falló: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  const intervalDays = getScrapeIntervalDays();

  if (options.once) {
    const ok = await runOnce(options);
    return ok ? 0 : 1;
  }

  console.log("⏰  RegateoApp · scheduler de scraping");
  console.log(`    Frecuencia: cada ${intervalDays} día(s) (SCRAPE_INTERVAL_DAYS)`);
  console.log(`    Tiendas: ${(options.stores ?? PANAMA_STORES.map((store) => store.slug)).join(", ")}`);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n👋  ${signal} recibido, cerrando scheduler…`);
    void sqlClient.end({ timeout: 5 }).finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (options.runNow) await runOnce(options);

  // eslint-disable-next-line no-constant-condition
  while (!shuttingDown) {
    const next = nextScrapeDate(new Date(), intervalDays);
    console.log(`\n⏭️   Próxima corrida: ${next.toISOString()} · ${formatPanama(next)}`);
    await sleepUntil(next);
    if (shuttingDown) break;
    await runOnce(options);
  }

  return 0;
}

let exitCode = 0;
try {
  exitCode = await main();
} catch (error) {
  console.error(`❌  Scheduler falló: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}

process.exit(exitCode);
