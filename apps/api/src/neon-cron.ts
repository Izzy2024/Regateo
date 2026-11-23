// ============================================================================
// Neon Function entrypoint: `cron` (Scheduled price refresh & alerts check)
// Triggered by Neon Function Trigger (`type: "schedule"`).
// Authenticates deliveries with `parseTriggerDelivery` from `@neon/functions/triggers`.
// ============================================================================
import { parseTriggerDelivery } from "@neon/functions/triggers";
import {
  evaluateAndDispatchPriceAlerts,
  runScrapePipeline,
} from "@regateo/scraper";
import { db, sql } from "@regateo/db";

const DEFAULT_CRON_STORES = [
  "lgshoppa",
  "sonypa",
  "samsungpa",
  "raenco",
  "pntpanama",
  "evisionstore",
  "multimax",
  "rodelag",
  "titan",
  "photura",
  "doitcenter",
  "yoytec",
  "ptytec",
];

function parseStoresEnv(): string[] {
  const raw = process.env.CRON_STORES?.trim();
  if (!raw) return DEFAULT_CRON_STORES;
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_CRON_STORES;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      let dbStatus = "connected";
      try {
        await db.execute(sql`select 1`);
      } catch {
        dbStatus = "disconnected";
      }
      return Response.json({
        ok: true,
        service: "regateo-cron-function",
        db: dbStatus,
        branch: process.env.NEON_BRANCH ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "method_not_allowed", message: "Use POST for Neon schedule triggers." },
        { status: 405, headers: { Allow: "GET, POST" } }
      );
    }

    const parsed = await parseTriggerDelivery(request);
    if (!parsed.ok) {
      const status = parsed.error === "invalid_body" ? 400 : 401;
      return Response.json(
        { ok: false, error: parsed.error },
        { status }
      );
    }

    const invocation = parsed.invocation;
    if (invocation.type !== "schedule") {
      return Response.json(
        { ok: false, error: "unsupported_trigger_type", type: invocation.type },
        { status: 400 }
      );
    }

    const stores = parseStoresEnv();
    const maxPerStore = Math.min(
      5000,
      Math.max(10, Number(process.env.CRON_MAX_PER_STORE ?? 400))
    );

    const startedAt = Date.now();
    const runs = await runScrapePipeline({
      stores,
      maxPerStore,
      useFirecrawl: false,
    });
    const alerts = await evaluateAndDispatchPriceAlerts();

    const summary = runs.map((run) => ({
      storeSlug: run.storeSlug,
      status: run.status,
      itemsFound: run.itemsFound,
      itemsUpserted: run.itemsUpserted,
      errorMessage: run.errorMessage ?? null,
    }));

    return Response.json({
      ok: true,
      invocationId: invocation.invocationId,
      triggerName: invocation.trigger.name,
      scheduledAt: invocation.data.scheduledAt,
      durationMs: Date.now() - startedAt,
      storesProcessed: summary.length,
      totalUpserted: summary.reduce((acc, r) => acc + r.itemsUpserted, 0),
      alertsEvaluated: alerts,
      runs: summary,
    });
  },
};
