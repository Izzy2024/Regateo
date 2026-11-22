// ============================================================================
// Observabilidad ligera: logging JSON estructurado + hooks opcionales de
// Langfuse (trazas LLM vía HTTP ingestion, sin SDK) y Sentry (import dinámico
// opcional). Todo es no-op seguro cuando las variables no están configuradas.
// ============================================================================
import type { MiddlewareHandler } from "hono";

// ---------------------------------------------------------------------------
// Logging JSON estructurado a consola
// ---------------------------------------------------------------------------
type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "regateoapp-api",
    event,
    ...data,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};

/** Middleware de logging estructurado (reemplaza el logger default de Hono). */
export const structuredLogger: MiddlewareHandler = async (c, next) => {
  const startAt = Date.now();
  await next();
  const durationMs = Date.now() - startAt;
  emit(c.res.status >= 500 ? "error" : "info", "http_request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
  });
};

// ---------------------------------------------------------------------------
// Sentry (opcional) — usa @sentry/node si está instalado; si no, log JSON.
// ---------------------------------------------------------------------------
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const spec: string = "@sentry/node";
  import(spec)
    .then((sentry) => {
      if (typeof sentry?.captureException === "function") {
        sentry.captureException(error);
      } else {
        emit("error", "exception", { message: err.message, ...context });
      }
    })
    .catch(() => {
      emit("error", "exception", {
        message: err.message,
        stack: err.stack,
        ...context,
      });
    });
}

// ---------------------------------------------------------------------------
// Langfuse (opcional) — ingestion HTTP pública con Basic auth PK:SK.
// Sin dependencia del SDK: batch fire-and-forget.
// ---------------------------------------------------------------------------
interface LangfuseGenerationEvent {
  name: string;
  model?: string;
  input: string;
  output?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  metadata?: Record<string, unknown>;
}

const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
const langfuseBaseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
const langfuseEnabled = Boolean(langfusePublicKey && langfuseSecretKey);

const langfuseQueue: Array<LangfuseGenerationEvent & { id?: string }> = [];
let langfuseFlushScheduled = false;

async function flushLangfuse(): Promise<void> {
  if (langfuseQueue.length === 0) return;
  const batch = langfuseQueue.splice(0, langfuseQueue.length);
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const traceId = crypto.randomUUID();
  const events = [
    {
      type: "trace-create",
      id: crypto.randomUUID(),
      timestamp: now,
      body: { id: traceId, name: "regateo-ai-chat" },
    },
    ...batch.map((body) => ({
      type: "generation-create",
      id: crypto.randomUUID(),
      timestamp: now,
      body: { ...body, traceId },
    })),
  ];
  const auth = btoa(`${langfusePublicKey}:${langfuseSecretKey}`);
  await fetch(`${langfuseBaseUrl}/api/public/ingestion`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ batchId, events }),
  }).catch(() => {
    // Observabilidad nunca debe afectar la respuesta al usuario.
  });
}

/** Registra una generación LLM en Langfuse (si está configurado). */
export function trackLlmGeneration(event: LangfuseGenerationEvent): void {
  if (!langfuseEnabled) return;
  langfuseQueue.push({ ...event, id: crypto.randomUUID() });
  if (!langfuseFlushScheduled) {
    langfuseFlushScheduled = true;
    setTimeout(() => {
      langfuseFlushScheduled = false;
      void flushLangfuse();
    }, 1000);
  }
}

/** Flush explícito (útil en shutdown). */
export async function flushObservability(): Promise<void> {
  if (langfuseEnabled) await flushLangfuse();
}
