# RegateoApp — Comparador Inteligente de Electrónica en Panamá

**RegateoApp** rastrea, normaliza y compara precios de productos electrónicos y línea blanca en las principales tiendas de Panamá (**Multimax, Panafoto, Rodelag, Almacenes Titán, Foto Sonido PTY, Audiofoto** y más) para mostrar siempre quién tiene el mejor precio con enlace directo verificado a cada tienda.

## Arquitectura (Stack 2026)

- **Monorepo:** Turborepo + Bun (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/scraper`)
- **Frontend (`apps/web`):** React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, Motion, TanStack Query, Zustand, React Hook Form + Zod, Recharts, Hono RPC (`hc<AppType>`)
- **Backend (`apps/api`):** Bun, Hono + Hono RPC, Better Auth, Zod, Vercel AI SDK (streaming SSE con tool calls vía OpenRouter/LiteLLM), Upstash Redis (caché/rate limit con fallback local), hooks para Langfuse / Sentry / PostHog
- **Base de Datos (`packages/db`):** PostgreSQL (Neon / Supabase connection pooler ready), Drizzle ORM, migración `pgvector` HNSW lista para búsqueda semántica
- **Scraping & Automatización (`packages/scraper`):** Firecrawl (SDK/CLI/Self-Hosted) + adaptadores Shopify/Magento + normalizador de modelos/SKUs + scheduler automático cada 3–5 días y GitHub Actions Cron

## Inicio Rápido

```bash
# 1. Instalar dependencias
bun install

# 2. Configurar variables de entorno
cp .env.example .env

# 3. Aplicar esquema a PostgreSQL
bun run db:push

# 4. Ejecutar primer scraping de tiendas de Panamá
bun run scrape

# 5. Levantar API (3001) y Web (5173)
bun run dev
```

## Scripts Principales

| Comando | Descripción |
| --- | --- |
| `bun run dev` | Inicia API y Frontend en modo desarrollo vía Turborepo |
| `bun run build` | Compila todo el monorepo |
| `bun run typecheck` | Verificación estricta de TypeScript en todos los paquetes |
| `bun run db:push` | Sincroniza el esquema Drizzle con PostgreSQL |
| `bun run scrape` | Ejecuta el motor de scraping contra tiendas de Panamá |
| `bun run scrape:schedule` | Inicia el programador automático cada `SCRAPE_INTERVAL_DAYS` días |
