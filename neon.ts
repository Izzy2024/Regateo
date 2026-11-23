import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: {
      allowedOrigins: ["http://localhost:5173", "http://localhost:4173"],
    },
  },
  auth: true,
  functions: {
    api: {
      name: "Regateo API",
      source: "apps/api/src/neon-api.ts",
      env: {
        NODE_ENV: "production",
        WEB_URL: { value: process.env.WEB_URL ?? "http://localhost:5173", required: false },
        ALLOWED_ORIGINS: { value: process.env.ALLOWED_ORIGINS, required: false },
        BETTER_AUTH_SECRET: { value: process.env.BETTER_AUTH_SECRET, required: true },
        CRON_SECRET: { value: process.env.CRON_SECRET, required: true },
        DEEPSEEK_API_KEY: { value: process.env.DEEPSEEK_API_KEY, required: false },
        DEEPSEEK_BASE_URL: { value: process.env.DEEPSEEK_BASE_URL, required: false },
        OPENROUTER_API_KEY: { value: process.env.OPENROUTER_API_KEY, required: false },
        AI_MODEL: { value: process.env.AI_MODEL ?? "deepseek-chat", required: false },
        RESEND_API_KEY: { value: process.env.RESEND_API_KEY, required: false },
        EMAIL_FROM: { value: process.env.EMAIL_FROM, required: false },
        ALERTS_FROM_EMAIL: { value: process.env.ALERTS_FROM_EMAIL, required: false },
        SUPPORT_EMAIL: { value: process.env.SUPPORT_EMAIL, required: false },
        UPSTASH_REDIS_REST_URL: { value: process.env.UPSTASH_REDIS_REST_URL, required: false },
        UPSTASH_REDIS_REST_TOKEN: { value: process.env.UPSTASH_REDIS_REST_TOKEN, required: false },
        TURNSTILE_SECRET_KEY: { value: process.env.TURNSTILE_SECRET_KEY, required: false },
      },
    },
    cron: {
      name: "Regateo Scheduled Price Refresh",
      source: "apps/api/src/neon-cron.ts",
      env: {
        NODE_ENV: "production",
        CRON_STORES: { value: process.env.CRON_STORES, required: false },
        CRON_MAX_PER_STORE: { value: process.env.CRON_MAX_PER_STORE ?? "400", required: false },
        RESEND_API_KEY: { value: process.env.RESEND_API_KEY, required: false },
        ALERTS_FROM_EMAIL: { value: process.env.ALERTS_FROM_EMAIL, required: false },
      },
    },
  },
  triggers: {
    "daily-price-refresh": {
      type: "schedule",
      function: "cron",
      // Todos los días a las 08:00 UTC (03:00 AM hora de Panamá)
      cron: "0 8 * * *",
      functionPath: "/cron",
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
