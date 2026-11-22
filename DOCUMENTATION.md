# Documentación Técnica Completa — RegateoApp

**RegateoApp** es un comparador de precios de electrónica, cómputo, telefonía, audio y línea blanca en la República de Panamá. Rastrea, normaliza, empareja por modelo exacto y compara alternativas similares entre **8 tiendas panameñas activas** con enlaces directos verificados a cada comercio, historial de precios, asistente **Regateo AI** en streaming con DeepSeek/OpenRouter, espacio personalizado para usuarios logueados (**Mi Espacio**), protección anti-bot (**CAPTCHA**) y cumplimiento con la **Ley 81 de 2019 de Protección de Datos Personales de Panamá**.

---

## 1. Arquitectura General (Stack 2026)

```text
+-------------------------------------------------------------------+
|                     FRONTEND (apps/web)                           |
|  React 19 + TypeScript + Vite 6 + Tailwind CSS 4                  |
|  UI: Primitivas shadcn/ui + 5 componentes ligeros Magic UI        |
|  Estado/Datos: TanStack Query + Zustand + React Hook Form + Zod   |
|  Gráficos: Recharts (lazy chunk) | Animación: Motion              |
|  Seguridad: CaptchaWidget (Cloudflare Turnstile / HMAC builtin)   |
+---------------------------------+---------------------------------+
                                  |
                  Hono RPC (AppType E2E) + SSE + Cookies
                                  v
+-------------------------------------------------------------------+
|                     BACKEND API (apps/api)                        |
|  Runtime: Bun | Framework: Hono | Auth: Better Auth (Drizzle PG)  |
|  Anti-Bot: Turnstile + HMAC challenge anti-replay + Rate Limit    |
|  IA: Vercel AI SDK (streamText + tools reales via DeepSeek/OR)    |
|  Caché: Upstash Redis (fallback en memoria en local)              |
|  Ops: Hooks Langfuse + Sentry + JSON Structured Logging           |
+----------------+----------------------------------+---------------+
                 |                                  |
        Drizzle ORM + Pooler                  Cron / CLI Interno
                 v                                  v
+---------------------------------+  +------------------------------+
|    BASE DE DATOS (packages/db)  |  |  SCRAPER (packages/scraper)  |
|  PostgreSQL 15 / Neon / Supa    |  |  8 adaptadores Panamá:       |
|  13 tablas + índices FK/filtro  |  |  Shopify JSON, Magento GQL,  |
|  pg_trgm GIN (búsqueda <10ms)   |  |  Next.js Data, Odoo, Laravel |
|  pgvector HNSW (migración SQL)  |  |  + Firecrawl (SDK/CLI)       |
+---------------------------------+  +------------------------------+
```

---

## 2. Estructura Completa del Proyecto

```text
regateoapp/
├── package.json                                # Workspaces Bun + scripts raíz (dev, build, typecheck, db:*, scrape:*)
├── turbo.json                                  # Pipeline Turborepo (build, typecheck, dev)
├── tsconfig.base.json                          # Configuración estricta compartida TypeScript
├── .env.example                                # Plantilla de variables de entorno (DB, Auth, DeepSeek, Turnstile, Redis, Ops)
├── .gitignore                                  # Ignora .env, node_modules, dist, .firecrawl, .agent-briefs
├── README.md                                   # Guía rápida de instalación y comandos
├── DOCUMENTATION.md                            # Esta documentación técnica completa
├── CHANGELOG.md                                # Registro de versiones y cambios
├── CONTRIBUTING.md                             # Guía de contribución y estándares
│
├── .github/workflows/
│   ├── ci.yml                                  # CI: install, typecheck, Biome (no bloqueante), bun test, build
│   └── scheduled-scrape.yml                    # Barrido DIARIO (08:00 UTC / 03:00 Panamá) + dispatch manual
│
├── scripts/
│   └── scrape-radar.ts                         # Script CLI interno del operador (scrape masivo + flush de caché API)
│
├── packages/
│   ├── shared/                                 # @regateo/shared — Fuente única de verdad (Zod + DTOs + normalizadores)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── schemas.ts                      # PANAMA_STORES (8 tiendas), categorías, Zod schemas y DTOs E2E
│   │       ├── normalize.ts                    # slugify, extractBrand, extractModelNumber, classifyCategory, formatUsdFromCents
│   │       └── import-calculator.ts             # calculateAmazonPanamaImport (CIF + courier + ITBMS/aduana, veredicto)
│   │
│   ├── db/                                     # @regateo/db — Esquema Drizzle ORM, cliente pooler y migraciones SQL
│   │   ├── drizzle.config.ts                   # Configuración Drizzle Kit (PostgreSQL)
│   │   ├── migrations/
│   │   │   ├── pg-trgm-search.sql              # Extensión pg_trgm + índices GIN para búsquedas rápidas en 20k+ productos
│   │   │   └── pgvector-hnsw.sql               # Extensión pgvector + índice HNSW para búsqueda semántica en Neon/Supabase
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts                       # Cliente postgres.js auto-compatible con Neon (-pooler) y Supabase (:6543)
│   │       └── schema.ts                       # 13 tablas: Auth (4), Catálogo/Scraping (5), Usuario/Alertas (4)
│   │
│   └── scraper/                                # @regateo/scraper — Motor multi-tienda, matcher estricto y scheduler
│       ├── README.md
│       └── src/
│           ├── index.ts                        # Exports públicos: pipeline, ingest, alertas, digest, agregados, candidatos
│           ├── pipeline.ts                     # Orquestador (2 tiendas en paralelo, AbortSignal, health-check, alertas)
│           ├── ingest.ts                       # Upsert seguro + guardrail 2.2x + color + agotados + agregados
│           ├── matching.ts                     # Matcher estricto (modelo/variante/panel/serie, familias, GTIN, colores)
│           ├── refresh-stats.ts                # refreshProductAggregates(): best/highest/savings/store_count O(1)
│           ├── candidates.ts                   # Candidatos multi-tienda (pg_trgm + reglas 1.65x/panel/tamaño/tier)
│           ├── alerts.ts                       # Motor real de alertas post-barrido (Resend + log + dedupe 24h)
│           ├── digest.ts                       # Canal WhatsApp/Telegram + resumen semanal de favoritos
│           ├── cleanup.ts                      # Re-agrupamiento, color backfill, agregados y reporte antes/después
│           ├── enrich.ts                       # Enriquecimiento cruzado por código de modelo entre tiendas
│           ├── firecrawl-client.ts             # Cliente unificado Firecrawl (SDK → CLI local → fallback HTTP)
│           ├── http.ts                         # Helper HTTP con retries, backoff exponencial y concurrencia controlada
│           ├── cli.ts                          # CLI `bun run scrape` (--stores, --max, --full, --no-firecrawl, --json)
│           ├── scheduler.ts                    # Daemon programado cada SCRAPE_INTERVAL_DAYS (3–5 días)
│           ├── scheduler-config.ts             # Validación y cálculo de próxima corrida
│           ├── types.ts                        # Interfaces RawScrapedItem, StoreAdapter, AdapterContext
│           ├── matching.test.ts                # Suite del matcher + candidatos (117 tests)
│           ├── phase3.test.ts                  # Suite Fase 3: import-calculator, digest y alertas (29 tests)
│           └── adapters/
│               ├── index.ts                    # Registro de los 8 adaptadores activos
│               ├── shopify.ts                  # Multimax, Rodelag, Almacenes Titán, Photura (colecciones + catálogo global)
│               ├── panafoto.ts                 # Panafoto (Magento 2 GraphQL paginado completo + fallback Firecrawl)
│               ├── doitcenter.ts               # Do it Center (Next.js __NEXT_DATA__ / _next/data + fallback Firecrawl)
│               ├── yoytec.ts                   # Yoytec (Odoo eCommerce HTML + Cheerio + fallback Firecrawl)
│               ├── ptytec.ts                   # PTYTEC (API catálogo Laravel webapi.ptytec.com + fallback Firecrawl)
│               └── firecrawl-store.ts          # Adaptador genérico Firecrawl (JSON-LD + heurísticas) para tiendas nuevas
│
├── apps/
│   ├── api/                                    # @regateo/api — Backend Hono + Better Auth + DeepSeek AI + Anti-Bot
│   │   ├── scripts/
│   │   │   ├── verify-endpoints.ts             # Verificación de contratos y validaciones Zod
│   │   │   ├── verify-me-space.ts              # Prueba E2E autenticada de Mi Espacio con Better Auth
│   │   │   ├── smoke-real-data.ts              # Smoke test de solo-lectura contra datos reales de Panamá
│   │   │   └── bench-scale.ts                  # Benchmark de rendimiento a escala 20,000+ productos
│   │   └── src/
│   │       ├── index.ts                        # Arranque servidor Bun (puerto 3001)
│   │       ├── env.ts                          # Carga segura de .env raíz del monorepo
│   │       ├── app.ts                          # Rutas encadenadas Hono + CORS + exportación `AppType` para Hono RPC
│   │       ├── lib/
│   │       │   ├── auth.ts                     # Better Auth + Drizzle adapter + crossSubDomainCookies
│   │       │   ├── cache.ts                    # Upstash Redis + Ratelimit (con fallback automático en memoria)
│   │       │   ├── captcha.ts                  # Cloudflare Turnstile + desafío HMAC-SHA256 anti-replay + honeypot
│   │       │   └── observability.ts            # Logging JSON estructurado + hooks Langfuse & Sentry
│   │       ├── routes/
│   │       │   └── ai.ts                       # POST /api/ai/chat (Vercel AI SDK SSE + DeepSeek/OpenRouter + tools PG)
│   │       └── services/
│   │           ├── catalog.ts                  # Búsqueda SQL, facets, deals, detalle, historial y motor de similares
│   │           └── user-space.ts               # Lógica de Mi Espacio (favoritos con delta de precio, listas y alertas)
│   │
│   └── web/                                    # @regateo/web — Frontend React 19 + Tailwind CSS 4 + Magic UI
│       ├── index.html                          # SEO es-PA + Plus Jakarta Sans + JetBrains Mono
│       ├── vite.config.ts                      # Vite 6 + @tailwindcss/vite + code-splitting optimizado
│       └── src/
│           ├── main.tsx                        # React QueryClientProvider + montaje raíz
│           ├── index.css                       # Tokens editorial-tech light-first, tabular-nums y keyframes Magic UI
│           ├── App.tsx                         # Shell principal, navegación, lazy views, CompareTray y Footer legal
│           ├── lib/
│           │   ├── api.ts                      # Cliente Hono RPC (`hc<AppType>`), fetch tipado, SSE AI y headers CAPTCHA
│           │   └── utils.ts                    # cn(), formateadores USD, fechas es-PA y sanitización de URLs externas
│           ├── store/
│           │   └── useFilterStore.ts           # Estado Zustand (filtros, vista, comparador rápido, favoritos invitado, URL sync)
│           ├── hooks/
│           │   └── useUserSpace.ts             # Sesión Better Auth + Mi Espacio + auto-sync de favoritos al loguearse
│           └── components/
│               ├── Header.tsx                  # Navegación fija (Explorar, Ofertas, Tiendas, Mi Espacio, Regateo AI, Cuenta)
│               ├── HeroSearch.tsx              # Buscador instantáneo + KPIs NumberTicker + Marquee de las 8 tiendas
│               ├── CategoryRibbon.tsx          # Cinta horizontal de categorías con conteos en vivo
│               ├── CategoryIcon.tsx            # Iconografía consistente por categoría
│               ├── FilterSidebar.tsx           # Filtros por tienda, marca, rango USD, stock y multi-tienda
│               ├── ProductCard.tsx             # Tarjeta de comparación, mejor precio, enlace directo y botón ♥
│               ├── ProductDetailModal.tsx      # Comparador exacto + Alternativas similares + Recharts + Alertas + Listas
│               ├── PriceHistoryChart.tsx       # Gráfico histórico multi-tienda con Recharts
│               ├── PriceAlertForm.tsx          # Formulario RHF + Zod + CaptchaWidget + aviso de privacidad
│               ├── CompareTray.tsx             # Comparador rápido lado a lado (hasta 3 productos)
│               ├── DealsView.tsx               # Mejores ahorros con BorderBeam en la oferta #1
│               ├── StoresDashboard.tsx         # Radar de las 8 tiendas activas (solo lectura; sin trigger público)
│               ├── AccountSpaceView.tsx        # Mi Espacio: Favoritos con bajadas, Listas/Presupuesto optimizado y Alertas
│               ├── AiAssistantDrawer.tsx       # Drawer Regateo AI con streaming SSE y estados por tool call
│               ├── AuthModal.tsx               # Registro / Login con CaptchaWidget y consentimiento Ley 81
│               ├── CaptchaWidget.tsx           # Widget anti-bot (Cloudflare Turnstile o desafío firmado integrado)
│               ├── PrivacyPolicyView.tsx       # Política de Privacidad completa (Ley 81 de 2019 — Panamá, Derechos ARCO)
│               ├── magicui/                    # 5 componentes ultraligeros (NumberTicker, Marquee, BorderBeam, ShimmerButton, BlurFade)
│               └── ui/                         # Primitivas accesibles (button, badge, input, card, dialog, sheet, skeleton, switch)
```

---

## 3. Esquema de Base de Datos (`packages/db/src/schema.ts`)

PostgreSQL con **13 tablas** indexadas desde el día uno en todas las claves foráneas y columnas de filtro frecuente:

| Grupo | Tabla | Propósito |
| --- | --- | --- |
| **Autenticación (Better Auth)** | `user`, `session`, `account`, `verification` | Usuarios, sesiones con cookies `HttpOnly`, credenciales y verificación |
| **Catálogo y Comparación** | `stores` | Registro de las 8 tiendas de Panamá (slug, color, plataforma, `last_scraped_at`) |
| | `products` | Producto canónico único (`match_key` estricto, marca, modelo, categoría, specs JSONB) + **columnas materializadas**: `best_price_cents`, `highest_price_cents`, `savings_cents/percent`, `store_discount_cents/percent`, `store_count`, `in_stock_count` (índices dedicados) |
| | `store_listings` | Oferta exacta de una tienda (`price_cents`, `original_price_cents`, stock, **`color`**, URL real verificable) |
| | `price_history` | Serie temporal de precios por listing para gráficos Recharts |
| | `scrape_runs` | Auditoría de cada barrido por tienda (motor, estado, encontrados, actualizados, error) |
| **Mi Espacio (Usuario)** | `user_favorites` | Favoritos persistentes + `saved_price_cents` para calcular bajadas desde que guardaste |
| | `user_lists` | Listas personalizadas de presupuesto (ej. *"Mi Setup PC"*, *"Línea Blanca Hogar"*) |
| | `user_list_items` | Productos y cantidades dentro de cada lista |
| | `price_alerts` | Alertas de precio objetivo por usuario/correo |

### Reglas de Producción de Base de Datos
1. **Connection Pooling obligatorio:** Usar Neon (`-pooler`) o Supabase (`:6543`). `packages/db/src/client.ts` detecta el pooler automáticamente y configura `prepare: false` + `ssl: "require"`.
2. **Búsqueda rápida (`pg_trgm`):** Aplicar `packages/db/migrations/pg-trgm-search.sql` para búsquedas `ILIKE` en <10ms con 20,000+ productos.
3. **Búsqueda semántica (`pgvector`):** Aplicar `packages/db/migrations/pgvector-hnsw.sql` en Neon/Supabase para activar el índice HNSW sobre `products.embedding`.

---

## 4. Contrato de Endpoints API (`apps/api`)

| Método y Ruta | Protección | Descripción |
| --- | --- | --- |
| `GET /api/health` | Pública | Estado de API, PostgreSQL y backend de caché (`upstash` / `memory`) |
| `GET /api/security/captcha` | Rate Limit `30/min` | Entrega configuración Turnstile o desafío HMAC anti-bot firmado |
| `POST /api/auth/sign-up/email` | **CAPTCHA + Rate Limit `12/min`** | Registro de usuario con Better Auth |
| `POST /api/auth/sign-in/email` | **CAPTCHA + Rate Limit `12/min`** | Inicio de sesión con Better Auth |
| `POST /api/auth/request-password-reset` | **Rate Limit** | Envía enlace de restablecimiento de contraseña |
| `POST /api/auth/forget-password` | **CAPTCHA + Rate Limit** | Alias compatible de recuperación de contraseña |
| `GET /api/auth/providers` | Pública | Proveedores disponibles (incluye Google OAuth si `GOOGLE_CLIENT_ID/SECRET`) |
| `ALL /api/auth/*` | Better Auth | Sesión (`get-session`), cierre (`sign-out`) y utilidades de auth |
| `GET /api/products` | Pública (Cacheada) | Búsqueda multi-token (nombre, marca, modelo, SKU, título de tienda), filtros, facets y paginación |
| `GET /api/products/deals` | Pública (Cacheada) | Top productos con mayor ahorro real entre tiendas o descuento |
| `GET /api/products/:slug` | Pública | Detalle completo: tabla exacta de tiendas, historial Recharts y `similarProducts` |
| `GET /api/products/:slug/similar` | Pública (Cacheada) | Competidores similares en otras tiendas puntuados por marca, specs, título y precio |
| `GET /api/stores` | Pública | Estado en vivo de las 8 tiendas y registro reciente de corridas |
| `GET /api/guides` · `GET /api/guides/:slug` | Pública (Cacheada) | Guías de compra por presupuesto/categoría con productos comparados |
| `GET /api/admin/analytics` | **`CRON_SECRET` / admin** | KPIs: clics outbound por tienda, búsquedas top, búsquedas sin resultado, cobertura multi-tienda |
| `POST /api/alerts` | **CAPTCHA + Rate Limit `10/min`** | Crear alerta de precio objetivo (se vincula al usuario si hay sesión) |
| `GET /api/alerts?email=...` | Pública | Consultar alertas activas por correo |
| `GET /api/alerts/confirm?token=...` | Pública | Verificación de correo antes de activar la alerta (`verified = true`) |
| `GET /out/:listingId` | Pública (medida) | Redirección 302 a la tienda real + registro de `outbound_clicks` (`src=web\|alert\|whatsapp\|digest`) |
| `POST /api/ai/chat` | Rate Limit `20/min` | Streaming SSE con Vercel AI SDK (`DeepSeek` / `OpenRouter`) y tools reales contra PostgreSQL |
| `GET /api/me/overview` | **Sesión Better Auth (`401`)** | Dashboard completo de Mi Espacio (KPIs, favoritos con bajadas, listas optimizadas, alertas) |
| `POST/DELETE /api/me/favorites` | **Sesión Better Auth (`401`)** | Guardar (con `savedPriceCents`) o quitar favoritos |
| `POST /api/me/favorites/sync` | **Sesión Better Auth (`401`)** | Migración automática de favoritos locales de invitado tras login |
| `POST/DELETE /api/me/lists` y `/items` | **Sesión Better Auth (`401`)** | CRUD de listas de presupuesto y cálculo de ahorro óptimo |
| `PATCH/DELETE /api/me/alerts/:id` | **Sesión Better Auth (`401`)** | Editar precio objetivo, pausar/activar o eliminar alertas propias |
| `POST /api/cron/scrape` | **`CRON_SECRET` obligatorio (`401`)** | Disparo interno de scraping para Cron Jobs / GitHub Actions |
| `POST /api/cron/invalidate-cache` | **`CRON_SECRET` obligatorio (`401`)** | Limpieza interna de caché post-scraping CLI |

---

## 5. Tiendas Monitoreadas, Matching y Operación Interna

### Tiendas Activas en Panamá (8)
1. **Panafoto** (`panafoto.com`) — Magento 2 GraphQL paginado completo
2. **Almacenes Titán** (`titan.com.pa`) — Shopify JSON (colecciones + catálogo filtrado de electrónica/electrodomésticos)
3. **Multimax** (`multimax.net`) — Shopify JSON
4. **Rodelag** (`rodelag.com`) — Shopify JSON
5. **Photura** (`photura.com`) — Shopify JSON
6. **Yoytec** (`yoytec.com`) — Odoo eCommerce HTML + Cheerio
7. **PTYTEC** (`ptytec.com`) — API Laravel (`webapi.ptytec.com/api`)
8. **Do it Center** (`doitcenter.com.pa`) — Next.js `_next/data` + fallback Firecrawl

### Reglas de Matching Estricto
- Nunca se fusionan productos distintos que solo compartan marca y tamaño (ej. *Sony BRAVIA 8 OLED 65"* vs *BRAVIA 2 LED 65"*).
- Se exige coincidencia exacta de modelo/serie y variante (tecnología de panel, almacenamiento, RAM).
- **Guardrail de precio:** dos listings con diferencia >2.2x nunca se fusionan en el mismo `product_id`; se muestran como **"Alternativas similares en otras tiendas"**.

### Operación Interna del Scraper (Cero Exposición Pública)
El panel web **Tiendas y Radar** es estrictamente de solo lectura para evitar colapsos por tráfico externo. Las corridas se ejecutan internamente vía:
- **Script operador:** `bun run scrape:radar` (o `bun run scrape:full`, o `bun run scrape:radar --stores=panafoto,yoytec`)
- **Scheduler VPS/Render:** `bun run scrape:schedule` (configurable con `SCRAPE_INTERVAL_DAYS=3`)
- **GitHub Actions:** `.github/workflows/scheduled-scrape.yml` (**cron diario** `0 8 * * *`, 03:00 Panamá) con despacho de alertas
- **Post-barrido:** `bun --filter @regateo/scraper alerts:check` (alertas), `candidates` (cobertura), `stats:refresh` (agregados), `digest` (canal + resumen semanal)
- **CI:** `.github/workflows/ci.yml` ejecuta `bun run typecheck`, Biome (diagnóstico de errores, no bloqueante), `bun test` y `bun run build`

---

## 6. Fase 2 y Fase 3 — Datos, Alertas, Digest y Cobertura

### 6.1 Agregados materializados (`packages/scraper/src/refresh-stats.ts`)
`refreshProductAggregates(productIds?)` recalcula en una sola sentencia SQL y deja en `products`:
`best_price_cents` (mínimo en stock, con fallback al mínimo absoluto), `highest_price_cents`,
`savings_cents/percent` (solo con 2+ tiendas en stock, tope 99%), `store_discount_cents/percent`
(descuento del ganador sobre su `original_price_cents`, 0 si supera 65%), `store_count` e
`in_stock_count`. Se ejecuta al final de cada ingesta, del re-agrupamiento y de la fusión de
candidatos; los productos sin listings quedan en 0 (nunca `NULL`). La API consulta estos campos
en O(1) con índices dedicados.

Además, `store_listings.color` se extrae del título en cada ingesta (`extractColor`) y se
backfillea en `cleanup.ts`; el color nunca forma parte del `match_key`.

### 6.2 Candidatos multi-tienda (`candidates.ts`)
Con `pg_trgm.similarity()` (fallback si la extensión no está) propone pares de productos de
tiendas distintas en **celulares, televisores y computadoras**. Solo auto-fusiona con:
misma marca/categoría, no accesorios, tiendas disjuntas, mismo modelo/serie/GTIN, mismo
almacenamiento, tamaño (TV y laptops), panel y tier (FE/Plus/Ultra/Pro Max), ratio de precio
**≤1.65** y similitud de título **≥0.35**. Reporta fusiones, rechazos y salto de cobertura, y
refresca los agregados. Con `OPENAI_API_KEY`/`OPENROUTER_API_KEY` queda lista la siguiente capa
de embeddings (pgvector + `embedding_text`).

### 6.3 Alertas reales (`alerts.ts`)
Al final de cada pipeline, `evaluateAndDispatchPriceAlerts()` toma alertas
`active AND verified`, sin disparo en 24 h, y cruza con la mejor oferta **en stock**. Si
`mejor precio ≤ objetivo`, envía correo HTML vía Resend (`RESEND_API_KEY`,
`ALERTS_FROM_EMAIL`) con asunto `🔥 Bajó de precio: …` y enlace medido
`/out/<listingId>?src=alert`; sin API key registra `[ALERTA DISPARADA]` estructurado. Actualiza
`price_alerts.last_triggered_at`. Las reglas puras (`shouldTriggerAlert`) están cubiertas por tests.

### 6.4 Digest semanal y canal WhatsApp/Telegram (`digest.ts`)
- `buildChannelDealsMessage()`: top 5 ofertas con `savings_cents > 0`, `store_count >= 2` e
  `in_stock_count >= 2`, formateadas en Markdown-friendly con precio, tienda ganadora, ahorro
  verificable y enlace `/out/<id>?src=whatsapp`.
- `sendWeeklyFavoritesDigest()`: usuarios con favoritos cuyo `best_price_cents` actual es menor
  que el `saved_price_cents` con el que guardaron; envía HTML por Resend o imprime el resumen
  estructurado (`--dry-run`). Script: `bun --filter @regateo/scraper digest`.

### 6.5 Calculadora de importación (`@regateo/shared/import-calculator.ts`)
`calculateAmazonPanamaImport()` estima el costo puesto en Panamá: ítem + tax USA opcional +
courier aéreo Miami→PTY (`$3.5/lb`, peso mínimo 0.5 lb) + handling + arancel/ITBMS estimado
(~12% si CIF > $100, exoneración por debajo) y devuelve `verdict: buy-local | import | similar`
con umbral del 5%. Se usa en el detalle de producto junto a **`priceInsight`**.

### 6.6 `priceInsight` (detector de descuentos falsos)
El detalle de producto expone `PriceInsightDTO`: días de historial, mínimo/máximo/promedio
histórico, `fakeDiscountFlag` + nota cuando el “descuento” es artificial, y recomendación
`buy-now | fair-price | wait | collecting-history` para decidir **¿compro ahora o espero?**.

### 6.7 Auth completa y cuenta
- **Reset de contraseña:** `POST /api/auth/request-password-reset` (Better Auth) con enlace por correo.
- **Google OAuth:** `GET /api/auth/providers` expone Google cuando `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
  están configurados; el callback vive en `/api/auth/*`.
- **Mi Espacio:** favoritos con `savedPriceCents`, listas de presupuesto, alertas y sync tras login.

### 6.8 Rutas SEO y analítica
- Web: `/c/:category` (categorías indexables), `/tienda/:slug` (landing por comercio) y guías de compra.
- API: `/api/guides` (guías con productos comparados) y `/api/admin/analytics` (clics outbound por
  tienda, búsquedas top y sin resultado, cobertura multi-tienda).
- Redirección medida `/out/:listingId` con contador `outbound_clicks`.

### 6.9 Calidad y entrega
- **Biome** (`biome.json`, `bun run lint` / `bun x biome check`) en CI como chequeo no bloqueante
  (`--diagnostic-level=error || true`).
- **PWA**: manifest + service worker para instalación y cacheo offline del catálogo consultado.
- **Tests:** `matching.test.ts` (matcher + candidatos) y `phase3.test.ts` (import-calculator,
  digest, alertas) — **146 tests en total**.

---

## 7. Seguridad Anti-Bot y Privacidad (Ley 81 de Panamá)
- **Anti-Bot / CAPTCHA:** En producción activar **Cloudflare Turnstile** configurando `TURNSTILE_SECRET_KEY` (backend) y `VITE_TURNSTILE_SITE_KEY` (frontend). En desarrollo local funciona de inmediato el desafío criptográfico HMAC-SHA256 de un solo uso + honeypot invisible + rate limiting por IP.
- **Privacidad:** Disponible en `?vista=privacidad` y en el footer global, con consentimiento obligatorio en el registro y derechos ARCO (Acceso, Rectificación, Cancelación, Oposición y Portabilidad) conforme a la **Ley 81 de 26 de marzo de 2019** de Panamá.
- **Privacidad en IA:** Nunca se llaman proveedores LLM desde el navegador; todas las consultas pasan por `apps/api/src/routes/ai.ts` y solo envían el texto de consulta comercial (nunca contraseñas ni datos personales de sesión).
