# RegateoApp — Comparador Inteligente de Electrónica en Panamá

**RegateoApp** rastrea, normaliza y compara precios reales en USD de productos electrónicos, cómputo, telefonía, audio y línea blanca en **8 tiendas activas de Panamá** (**Panafoto, Almacenes Titán, Multimax, Rodelag, Yoytec, PTYTEC, Photura y Do it Center**), mostrando quién tiene el mejor precio, alternativas similares en otras tiendas, historial de precios, asistente **Regateo AI** con DeepSeek y enlaces directos verificados a cada tienda.

> Para la arquitectura detallada, mapa completo de archivos, esquema de base de datos, contratos de API y guía de seguridad/privacidad, consulta [DOCUMENTATION.md](./DOCUMENTATION.md).

## Stack Principal (2026)

- **Monorepo:** Turborepo + Bun (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/scraper`, `scripts/`)
- **Frontend (`apps/web`):** React 19, TypeScript, Vite 6, Tailwind CSS 4, shadcn/ui + 5 componentes ligeros de Magic UI (`NumberTicker`, `Marquee`, `BorderBeam`, `ShimmerButton`, `BlurFade`), Motion, TanStack Query, Zustand, React Hook Form + Zod, Recharts (lazy), Hono RPC (`hc<AppType>`)
- **Backend (`apps/api`):** Bun, Hono + Hono RPC, Better Auth, Zod, protección anti-bot CAPTCHA (Cloudflare Turnstile + desafío HMAC anti-replay), Upstash Redis (caché/rate-limit con fallback local), Vercel AI SDK (streaming SSE con DeepSeek / OpenRouter + tools reales contra PostgreSQL)
- **Datos (`packages/db`):** PostgreSQL 15 / Neon / Supabase (pooler-safe), Drizzle ORM (13 tablas indexadas), `pg_trgm` GIN + `pgvector` HNSW
- **Scraping Interno (`packages/scraper` + `scripts/scrape-radar.ts`):** Adaptadores reales para 8 tiendas panameñas + Firecrawl (SDK/CLI) + matcher estricto de modelos + automatización cada 3–5 días

## Inicio Rápido

```bash
# 1. Instalar dependencias
bun install

# 2. Configurar variables de entorno (.env está en .gitignore)
cp .env.example .env

# 3. Sincronizar esquema Drizzle + índices de búsqueda rápida
bun run db:push
psql -d regateoapp_dev -f packages/db/migrations/pg-trgm-search.sql

# 4. Ejecutar barrido interno del radar de precios (8 tiendas de Panamá)
bun run scrape:radar

# 5. Levantar API (http://localhost:3001) y Web (http://localhost:5173)
bun run dev
```

## Comandos Principales

| Comando | Descripción |
| --- | --- |
| `bun run dev` | Levanta API (`:3001`) y Frontend (`:5173`) vía Turborepo |
| `bun run build` | Compila API y Frontend para producción |
| `bun run typecheck` | Verificación TypeScript estricta en los 5 paquetes |
| `bun run db:push` | Aplica el esquema Drizzle en PostgreSQL |
| `bun run scrape:radar` | **Operación interna:** barrido completo + limpieza de caché API + reporte |
| `bun run scrape:full` | Barrido masivo sin techo práctico (hasta 20,000 por tienda) |
| `bun run scrape:schedule` | Daemon programado cada `SCRAPE_INTERVAL_DAYS` días (default 3) |
