# Documentación Técnica — RegateoApp

## Estructura del Monorepo

```text
regateoapp/
├── apps/
│   ├── api/                 # Backend Hono + Better Auth + Vercel AI SDK + Hono RPC
│   └── web/                 # Frontend React 19 + Tailwind 4 + TanStack Query + Recharts
├── packages/
│   ├── db/                  # Esquemas Drizzle, cliente pooler-safe y migración pgvector
│   ├── shared/              # Esquemas Zod, tipos DTO, registro de tiendas y normalizador
│   └── scraper/             # Motor Firecrawl + adaptadores Panamá + scheduler 3-5 días
├── .github/workflows/       # Automatización programada (cron cada 3 días)
├── AGENT_CONTRACTS.md       # Contratos API y fronteras entre módulos
├── README.md
├── CHANGELOG.md
└── CONTRIBUTING.md
```

## Reglas de Base de Datos

1. **Connection Pooling:** En producción usar siempre Neon (`-pooler`) o Supabase (`:6543`). `packages/db/src/client.ts` detecta automáticamente el pooler y desactiva `prepare` (`prepare: false`).
2. **Índices desde el día uno:** Todas las claves foráneas (`product_id`, `store_id`, `listing_id`, `user_id`) y columnas de filtro (`category`, `brand`, `model_number`, `price_cents`, `in_stock`, `recorded_at`) están indexadas en `packages/db/src/schema.ts`.
3. **Búsqueda Semántica (`pgvector`):** Ejecutar `packages/db/migrations/pgvector-hnsw.sql` en Neon o Supabase para habilitar el índice HNSW sobre `products.embedding`.

## Automatización de Scraping (Cada 3–5 Días)

RegateoApp incluye tres vías complementarias para mantener los precios frescos:

1. **GitHub Actions Cron:** `.github/workflows/scheduled-scrape.yml` ejecuta `bun run scrape` cada 3 días (`0 8 */3 * *`) o llama al webhook protegido `POST /api/cron/scrape`.
2. **Scheduler Bun (`bun run scrape:schedule`):** Daemon ligero configurable por `SCRAPE_INTERVAL_DAYS=3` (o `4` / `5`) ideal para VPS/Render Worker.
3. **Endpoint HTTP (`POST /api/cron/scrape`):** Protegido con `CRON_SECRET`, listo para Render Cron Jobs, Railway Cron o Cloudflare Cron Triggers.

## Cómo Agregar una Nueva Tienda de Panamá

1. Añadir su configuración en `PANAMA_STORES` dentro de `packages/shared/src/schemas.ts`.
2. Si usa Shopify, el adaptador genérico Shopify funciona de inmediato sin código extra.
3. Si usa Magento, WooCommerce o HTML custom, el adaptador **Firecrawl** extrae automáticamente catálogo, precios en USD, imagen y enlace directo.
