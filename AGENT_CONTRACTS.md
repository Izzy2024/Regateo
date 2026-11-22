# RegateoApp — Contratos de Agentes y Arquitectura

Este documento define las **fronteras estrictas de propiedad** y los **contratos exactos** para los 3 agentes trabajando en paralelo sobre el monorepo `regateoapp`.

## Regla de Oro (Cero Colisiones)
- **NO modificar** `package.json` raíz, `turbo.json`, `packages/shared/*`, ni `packages/db/*` (ya están listos y sincronizados con PostgreSQL local `regateoapp_dev`).
- Cada agente trabaja exclusivamente en su directorio asignado:
  1. **Agente Backend (`apps/api`)** — `pi-bolt` (Panel Superior Derecho)
  2. **Agente Scraper & Automatización (`packages/scraper` + `.github/workflows/scheduled-scrape.yml`)** — `pi` (Panel Inferior Izquierdo)
  3. **Agente Frontend & Diseño (`apps/web`)** — `omp` (Panel Inferior Derecho)

---

## Contrato 1: `@regateo/scraper` (`packages/scraper/src/index.ts`)
Debe exportar:
```ts
export interface ScrapeRunSummary {
  runId: string;
  storeSlug: string;
  engine: string;
  status: "completed" | "failed";
  itemsFound: number;
  itemsUpserted: number;
  errorMessage?: string;
}

export function ensureStoresSeeded(): Promise<void>;
export function runScrapePipeline(options?: {
  stores?: string[];
  maxPerStore?: number;
  useFirecrawl?: boolean;
}): Promise<ScrapeRunSummary[]>;
```
- Debe soportar scraping real con **Firecrawl** (`firecrawl` CLI ya autenticado en el sistema + `@mendable/firecrawl-js` cuando exista `FIRECRAWL_API_KEY` o `FIRECRAWL_API_URL` self-hosted) y adaptadores directos Shopify JSON para **Multimax** (`multimax.net`), **Rodelag** (`rodelag.com`) y **Almacenes Titán** (`titan.com.pa`), más Firecrawl para **Panafoto** (`panafoto.com`), **Foto Sonido PTY** (`fotosonidopty.com`) y **Audiofoto** (`audiofotopro.com`).
- Debe normalizar marca, modelo y categoría con `@regateo/shared` (`extractBrand`, `extractModelNumber`, `classifyCategory`, `buildMatchKey`), hacer upsert en `products`, `store_listings` y registrar puntos en `price_history` y `scrape_runs`.
- Debe incluir automatización cada 3–5 días (`SCRAPE_INTERVAL_DAYS`, default `3`):
  - `packages/scraper/src/scheduler.ts` (`bun run scrape:schedule`)
  - `.github/workflows/scheduled-scrape.yml` (cron `0 8 */3 * *`, configurable)
- Al terminar de implementar, el Agente Scraper **debe ejecutar** `bun run scrape` para poblar `regateoapp_dev` con productos reales de electrónica de Panamá (y comparaciones multi-tienda verificables con URLs reales).

---

## Contrato 2: `@regateo/api` (`apps/api/src/app.ts` y `apps/api/src/index.ts`)
- Puerto por defecto: `process.env.PORT ?? 3001`.
- CORS habilitado para `process.env.WEB_URL ?? "http://localhost:5173"` con `credentials: true`.
- Exportar `export type AppType = typeof app` desde `apps/api/src/app.ts` usando rutas encadenadas de Hono para tipado E2E con `hc<AppType>`.
- Rutas exactas (todas bajo `/api`):
  - `GET /api/health` -> `{ ok: true, service: "regateoapp-api", timestamp, db: "connected", cache: "upstash" | "memory" }`
  - `ALL /api/auth/*` -> Better Auth handler (`drizzleAdapter(db, { provider: "pg" })`, `crossSubDomainCookies` cuando `COOKIE_DOMAIN` esté configurado).
  - `GET /api/products` -> Validado con `productSearchQuerySchema` (`@regateo/shared`). Retorna:
    ```json
    {
      "items": ProductSummaryDTO[],
      "pagination": { "page": 1, "limit": 24, "total": 100, "totalPages": 5 },
      "facets": {
        "categories": [{ "key": "televisores", "count": 12 }],
        "brands": [{ "name": "Samsung", "count": 10 }],
        "stores": [{ "slug": "multimax", "name": "Multimax", "count": 20 }]
      },
      "meta": { "cached": false, "lastScrapedAt": "ISO..." }
    }
    ```
  - `GET /api/products/deals` -> Top productos con mayor ahorro real entre tiendas (o mayor descuento sobre `originalPriceCents`), retorna `{ items: ProductSummaryDTO[] }`.
  - `GET /api/products/:slug` -> Retorna `{ product: ProductDetailDTO }` (incluye `listings` ordenados de menor a mayor precio y `priceHistory` agrupado por fecha/tienda para Recharts).
  - `GET /api/stores` -> Retorna `{ stores: StoreStatusDTO[], recentRuns: ScrapeRun[] }`.
  - `POST /api/alerts` -> Validado con `createPriceAlertSchema`. Guarda en `price_alerts`, retorna `201 { alert: ... }`.
  - `GET /api/alerts?email=...` -> Lista alertas activas para ese correo.
  - `POST /api/ai/chat` -> Validado con `aiChatRequestSchema`. Usa **Vercel AI SDK** (`streamText` + tools `searchProducts`, `compareProductPrices`, `getBestDeals`) a través del Gateway OpenRouter/OpenAI-compatible (`OPENROUTER_API_KEY`). Emite SSE (`text/event-stream`) con eventos claros por estado de tool call:
    - `data: {"type":"tool-call","toolCallId":"...","toolName":"searchProducts","state":"loading","args":{...}}\n\n`
    - `data: {"type":"tool-result","toolCallId":"...","toolName":"searchProducts","state":"result","result":{...}}\n\n`
    - `data: {"type":"text-delta","delta":"..."}\n\n`
    - `data: {"type":"done"}\n\n`
    Si no hay `OPENROUTER_API_KEY` configurada en local, ejecuta igualmente las herramientas reales contra PostgreSQL y transmite un streaming determinista inteligente (con los mismos eventos SSE `tool-call -> tool-result -> text-delta -> done`) para que la experiencia funcione 100% en desarrollo!
  - `POST /api/cron/scrape` -> Protegido con header `x-cron-secret` o `Authorization: Bearer <CRON_SECRET>` (y en dev acepta trigger manual desde panel). Invoca `runScrapePipeline` de `@regateo/scraper` y limpia caché.

---

## Contrato 3: `@regateo/web` (`apps/web`)
- Stack: React 19 + TypeScript + Vite + Tailwind CSS 4 (`@tailwindcss/vite`) + componentes accesibles estilo shadcn/ui + Motion (`motion/react`) + TanStack Query + Zustand + React Hook Form + Zod (`@regateo/shared`) + Recharts + Hono RPC (`hc<AppType>`).
- Base API URL: `import.meta.env.VITE_API_URL ?? "http://localhost:3001"`.
- Vistas y funcionalidades clave (superando 1000x a `elchantin.com`):
  1. **Hero & Buscador Instantáneo**: Barra de búsqueda ultra-rápida con sugerencias ("Lavadora Samsung", "Mouse Logitech", "Smart TV 55", "Laptop HP"), chips de categorías y resumen en vivo de tiendas monitoreadas y ahorro promedio detectado en Panamá.
  2. **Catálogo & Comparador de Precios**:
     - Filtros por categoría, tienda (Multimax, Panafoto, Rodelag, Titán, Foto Sonido, Audiofoto), marca, rango de precio, "Solo en stock", "Comparables en 2+ tiendas", y ordenamiento ("Mayor ahorro", "Menor precio", "Más tiendas").
     - Tarjetas de producto limpias con: imagen real, marca/modelo, **Badge de Mejor Precio** (`$XXX.XX` en `tabular-nums`), tienda ganadora con su color de identidad, **ahorro en USD y %** vs tienda más cara, mini-tabla comparativa de las tiendas que lo tienen, y botón directo **"Ver en [Tienda] ↗"** hacia la URL real del producto para verificar el precio.
  3. **Vista / Modal Detallada de Producto**:
     - Matriz completa de comparación por tienda (precio actual, diferencia `+$XX.XX` vs el mejor precio, disponibilidad, fecha de última verificación y enlace directo verificado).
     - **Gráfico histórico de precios (Recharts)** multi-tienda (líneas por tienda en USD con tooltip enriquecido).
     - **Formulario de Alerta de Precio** (React Hook Form + Zod `createPriceAlertSchema`) para avisar cuando baje al precio deseado.
  4. **Asistente IA "Regateo AI" (Drawer lateral / panel flotante)**:
     - Streaming SSE real contra `POST /api/ai/chat`.
     - Visualización clara de estados por tool call (`loading` spinner -> `result` cards clicables -> `error`) + recomendaciones de compra con links directos.
  5. **Monitor de Tiendas y Automatización (Tab/Sección)**:
     - Estado en tiempo real de las 6+ tiendas panameñas, cantidad de productos indexados, última fecha de scraping, frecuencia programada (cada 3 días) y botón para disparar actualización manual (con confirmación visual).
  6. **Auth Modal (Better Auth)**: Registro / inicio de sesión conectado a `/api/auth/*` para guardar alertas y favoritos.
