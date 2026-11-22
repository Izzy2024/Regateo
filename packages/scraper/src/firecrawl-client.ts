import FirecrawlApp from "@mendable/firecrawl-js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_HEADERS, fetchText, sleep } from "./http";
import type { FirecrawlScrapeResult } from "./types";

/**
 * Unified Firecrawl client with a three step degradation chain:
 *
 *   1. `@mendable/firecrawl-js`  — Firecrawl Cloud (`FIRECRAWL_API_KEY`) or a
 *      self-hosted instance (`FIRECRAWL_API_URL`, no key required).
 *   2. Local `firecrawl` CLI     — already authenticated on this machine, so
 *      local development works with zero configuration.
 *   3. Direct HTTP + Cheerio     — the scraper must never take down the
 *      pipeline, even when Firecrawl quota is exhausted or the site blocks it.
 */

export type FirecrawlMode = "sdk" | "cli" | "http";

export interface FirecrawlClientOptions {
  apiKey?: string | null;
  apiUrl?: string | null;
  /** Disable the CLI fallback (used by `--no-firecrawl` CI jobs). */
  allowCli?: boolean;
  /** Disable the direct HTTP fallback (rarely useful). */
  allowHttpFallback?: boolean;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface FirecrawlStatus {
  mode: FirecrawlMode;
  sdkConfigured: boolean;
  cliAvailable: boolean;
  apiUrl: string | null;
  quotaExhausted: boolean;
}

interface CliScrapePayload {
  data?: CliScrapePayload;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  metadata?: Record<string, unknown>;
  success?: boolean;
  error?: string;
}

const QUOTA_PATTERN = /(quota|credits?|insufficient|402|payment required)/i;
const RATE_LIMIT_PATTERN = /(rate.?limit|too many requests|req\/min|429|resets? at)/i;
/** Firecrawl CLI quota is ~12 req/min; pace calls to stay under it. */
const DEFAULT_MIN_INTERVAL_MS = 6_000;

function looksLikeQuotaError(message: string): boolean {
  return QUOTA_PATTERN.test(message) && !RATE_LIMIT_PATTERN.test(message);
}

function looksLikeRateLimitError(message: string): boolean {
  return RATE_LIMIT_PATTERN.test(message);
}

function normalizeLinks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((link): link is string => typeof link === "string");
  }
  return [];
}

export class FirecrawlClient {
  private readonly apiKey: string | null;
  private readonly apiUrl: string | null;
  private readonly allowCli: boolean;
  private readonly allowHttpFallback: boolean;
  private readonly timeoutMs: number;
  private readonly verbose: boolean;

  private sdk: FirecrawlApp | null = null;
  private sdkFailed = false;
  private cliPath: string | null;
  private cliFailed = false;
  private quotaExhausted = false;
  private lastCallAt = 0;
  private readonly minIntervalMs: number;

  constructor(options: FirecrawlClientOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? "").trim() || null;
    this.apiUrl = (options.apiUrl ?? process.env.FIRECRAWL_API_URL ?? "").trim() || null;
    this.allowCli = options.allowCli ?? true;
    this.allowHttpFallback = options.allowHttpFallback ?? true;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.verbose = options.verbose ?? false;
    this.minIntervalMs = Number(process.env.FIRECRAWL_MIN_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS);
    this.cliPath = this.allowCli ? this.detectCli() : null;
  }

  private log(message: string): void {
    if (this.verbose) console.log(`[firecrawl] ${message}`);
  }

  /** Ensures a minimum delay between Firecrawl calls (CLI is 12 req/min). */
  private async pace(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
    if (wait > 1) await sleep(wait);
    this.lastCallAt = Date.now();
  }

  private detectCli(): string | null {
    try {
      const bun = (globalThis as { Bun?: typeof Bun }).Bun;
      if (bun?.which) return bun.which("firecrawl") ?? null;
    } catch {
      // ignore – fall through to a plain PATH lookup below
    }
    try {
      const bun = (globalThis as { Bun?: typeof Bun }).Bun;
      if (!bun?.spawnSync) return null;
      const result = bun.spawnSync(["which", "firecrawl"], { stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) return null;
      const path = result.stdout.toString().trim().split("\n")[0];
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }

  isSdkConfigured(): boolean {
    return Boolean(this.apiKey || this.apiUrl);
  }

  isCliAvailable(): boolean {
    return Boolean(this.cliPath);
  }

  status(): FirecrawlStatus {
    return {
      mode: this.isSdkConfigured() ? "sdk" : this.isCliAvailable() ? "cli" : "http",
      sdkConfigured: this.isSdkConfigured(),
      cliAvailable: this.isCliAvailable(),
      apiUrl: this.apiUrl,
      quotaExhausted: this.quotaExhausted,
    };
  }

  private initSdk(): FirecrawlApp | null {
    if (this.sdk) return this.sdk;
    if (this.sdkFailed || !this.isSdkConfigured()) return null;
    try {
      this.sdk = new FirecrawlApp({
        apiKey: this.apiKey ?? undefined,
        apiUrl: this.apiUrl ?? undefined,
      });
      return this.sdk;
    } catch (error) {
      this.sdkFailed = true;
      this.log(`SDK no disponible: ${(error as Error).message}`);
      return null;
    }
  }

  private async scrapeWithSdk(url: string): Promise<FirecrawlScrapeResult> {
    const app = this.initSdk();
    if (!app) throw new Error("Firecrawl SDK no configurado");
    const response = await app.scrapeUrl(url, {
      formats: ["html", "links", "markdown"],
      onlyMainContent: false,
      timeout: this.timeoutMs,
    });

    if (!response || typeof response !== "object") {
      throw new Error("Respuesta vacía del SDK de Firecrawl");
    }
    if ("success" in response && response.success === false) {
      throw new Error(
        `Firecrawl SDK error: ${String((response as { error?: string }).error ?? "desconocido")}`
      );
    }

    const payload = response as unknown as CliScrapePayload & { data?: CliScrapePayload };
    const data = payload.data ?? payload;
    return {
      url,
      source: "sdk",
      html: data.html ?? data.rawHtml,
      markdown: data.markdown,
      links: normalizeLinks(data.links),
    };
  }

  private async scrapeWithCli(url: string): Promise<FirecrawlScrapeResult> {
    const cli = this.cliPath;
    const bun = (globalThis as { Bun?: typeof Bun }).Bun;
    if (!cli || !bun?.spawn) throw new Error("CLI de Firecrawl no disponible");

    const dir = await mkdtemp(join(tmpdir(), "regateo-firecrawl-"));
    const outputFile = join(dir, "scrape.json");
    try {
      const args = [
        cli,
        "scrape",
        url,
        "--format",
        "html,links,markdown",
        "--json",
        "--full-page",
        "--wait-for",
        "2500",
        "--output",
        outputFile,
      ];
      const proc = bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });

      const timeout = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // already exited
        }
      }, this.timeoutMs);

      const [exitCode, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      clearTimeout(timeout);

      let raw = "";
      try {
        raw = await readFile(outputFile, "utf8");
      } catch {
        raw = await new Response(proc.stdout).text();
      }

      if (exitCode !== 0 || !raw.trim().startsWith("{")) {
        const details = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        throw new Error(`CLI firecrawl falló (exit ${exitCode}): ${details || "sin salida"}`);
      }

      const parsed = JSON.parse(raw) as CliScrapePayload;
      const data = parsed.data ?? parsed;
      const result: FirecrawlScrapeResult = {
        url,
        source: "cli",
        html: data.html ?? data.rawHtml,
        markdown: data.markdown,
        links: normalizeLinks(data.links),
      };
      if (!result.html && !result.markdown) {
        throw new Error("CLI firecrawl devolvió contenido vacío");
      }
      return result;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Runs one Firecrawl mode with pacing, one retry on rate limits and graceful
   * degradation on quota errors.
   */
  private async tryMode(
    mode: "sdk" | "cli",
    run: () => Promise<FirecrawlScrapeResult>,
    errors: string[]
  ): Promise<FirecrawlScrapeResult | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.pace();
      try {
        return await run();
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        errors.push(`${mode}: ${message}`);

        if (looksLikeRateLimitError(message)) {
          if (attempt === 0) {
            this.log(`rate limit en ${mode}, reintentando en 20s`);
            await sleep(20_000);
            continue;
          }
        } else if (looksLikeQuotaError(message)) {
          this.quotaExhausted = true;
          this.log(`cuota de Firecrawl agotada: ${message.slice(0, 120)}`);
        }

        if (/no encontrado|not found|ENOENT/i.test(message)) this.cliFailed = true;
        return null;
      }
    }
    return null;
  }

  /**
   * Scrapes one URL trying SDK → CLI → direct HTTP.
   * Never throws unless every single fallback is exhausted.
   */
  async scrape(url: string, options: { preferHttp?: boolean } = {}): Promise<FirecrawlScrapeResult> {
    const errors: string[] = [];

    if (!options.preferHttp && !this.quotaExhausted) {
      if (this.isSdkConfigured() && !this.sdkFailed) {
        const result = await this.tryMode("sdk", () => this.scrapeWithSdk(url), errors);
        if (result) return result;
      }

      if (this.cliPath && !this.cliFailed) {
        const result = await this.tryMode("cli", () => this.scrapeWithCli(url), errors);
        if (result) return result;
      }
    }

    if (this.allowHttpFallback) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const html = await fetchText(url, {
            timeoutMs: Math.min(this.timeoutMs, 30_000),
            headers: BROWSER_HEADERS,
          });
          return { url, source: "http", html };
        } catch (error) {
          errors.push(`http: ${(error as Error).message}`);
          if (attempt === 0) await sleep(500);
        }
      }
    }

    throw new Error(`No se pudo obtener ${url} → ${errors.join(" | ")}`);
  }

  /** Convenience wrapper that swallows errors and returns `null`. */
  async tryScrape(url: string, options: { preferHttp?: boolean } = {}): Promise<FirecrawlScrapeResult | null> {
    try {
      return await this.scrape(url, options);
    } catch (error) {
      this.log(`tryScrape falló (${url}): ${(error as Error).message}`);
      return null;
    }
  }
}

let singleton: FirecrawlClient | null = null;

/** Shared client so quota detection and CLI probing happen only once per run. */
export function getFirecrawlClient(options: FirecrawlClientOptions = {}): FirecrawlClient {
  if (!singleton) singleton = new FirecrawlClient(options);
  return singleton;
}

export function resetFirecrawlClient(): void {
  singleton = null;
}
