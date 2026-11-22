// ============================================================================
// Punto de entrada del servidor (Bun).
// ============================================================================
import "./env";
import { app } from "./app";
import { logger, flushObservability } from "./lib/observability";
import { cacheBackend } from "./lib/cache";

const port = Number(process.env.PORT ?? 3001);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  // SSE del asistente IA: conexiones activas de hasta ~4 minutos.
  idleTimeout: 255,
});

logger.info("api_started", {
  port,
  health: `http://localhost:${port}/api/health`,
  cache: cacheBackend,
  environment: process.env.NODE_ENV ?? "development",
});

async function shutdown(signal: string) {
  logger.info("api_shutdown", { signal });
  await flushObservability();
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
