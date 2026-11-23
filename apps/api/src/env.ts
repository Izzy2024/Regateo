// ============================================================================
// Env bootstrap — carga variables del .env raíz del monorepo cuando la API
// se ejecuta con cwd = apps/api (turbo/bun no propagan el .env raíz).
// Idempotente: solo completa variables ausentes, nunca sobreescribe.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function applyRootEnvIfPresent(): void {
  try {
    // import.meta.dir es fiable al ejecutar archivos reales; en repl/eval puede
    // resolver al cwd. Probamos ambos candidatos para máxima robustez.
    const candidates = [
      join(import.meta.dir, "..", "..", ".env"), // apps/api/src -> monorepo/.env
      join(import.meta.dir, ".env"),
      join(process.cwd(), ".env"),
      join(process.cwd(), "..", ".env"),
      join(process.cwd(), "..", "..", ".env"),
    ];
    const rootEnvPath = candidates.find((candidate) => existsSync(candidate));
    if (!rootEnvPath) return;

    const raw = readFileSync(rootEnvPath, "utf8");
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // El .env raíz es un best-effort en desarrollo; ignorar errores de lectura.
  }
}

applyRootEnvIfPresent();

export const env = {
  port: Number(process.env.PORT ?? 3001),
  webUrl: process.env.WEB_URL ?? "http://localhost:5173",
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  isProduction: process.env.NODE_ENV === "production",
  cronSecret: process.env.CRON_SECRET,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  aiModel: process.env.AI_MODEL ?? "openai/gpt-4o-mini",
  neonBranch: process.env.NEON_BRANCH,
  neonAuthBaseUrl: process.env.NEON_AUTH_BASE_URL,
  neonAuthJwksUrl: process.env.NEON_AUTH_JWKS_URL,
  neonAiGatewayBaseUrl: process.env.NEON_AI_GATEWAY_BASE_URL,
  neonAiGatewayToken: process.env.NEON_AI_GATEWAY_TOKEN,
  neonRealtimeUrl: process.env.NEON_REALTIME_URL,
  neonRealtimeSecret: process.env.NEON_REALTIME_SECRET,
} as const;
