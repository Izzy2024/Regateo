# Changelog — RegateoApp

Todos los cambios relevantes del proyecto se documentan aquí siguiendo [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [0.1.0] - 2026-11-21

### Agregado
- Monorepo Turborepo + Bun (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/scraper`).
- Esquema PostgreSQL con Drizzle ORM, índices en todas las FKs y columnas de filtro, tablas Better Auth y migración `pgvector` HNSW.
- Motor de scraping híbrido con Firecrawl + adaptadores para tiendas de Panamá (Multimax, Panafoto, Rodelag, Almacenes Titán, Foto Sonido PTY, Audiofoto) y normalizador de modelos/SKUs.
- Automatización programada cada 3–5 días (scheduler Bun, endpoint cron y GitHub Actions).
- API Hono con tipado E2E (`Hono RPC`), Better Auth, caché/rate-limit Upstash Redis y asistente Regateo AI en streaming SSE con tool calls.
- Interfaz web React 19 + Tailwind CSS 4 + Motion + Recharts con comparador de precios, historial multi-tienda, enlaces directos verificados, alertas de precio y panel de tiendas.
