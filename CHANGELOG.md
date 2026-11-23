# Changelog — Regateo

Todos los cambios relevantes del proyecto se documentan aquí siguiendo [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [0.6.0] - 2026-11-23

### Infraestructura Backend en Neon (Postgres, Auth, AI Gateway y Realtime)
- **Neon CLI y configuración declarativa (`neon.ts`):** proyecto enlazado a la rama `production` (`crimson-credit-44656293`) con los 4 servicios habilitados (`postgres`, `auth`, `ai-gateway`, `realtime` con `allowedOrigins` para desarrollo local).
- **Neon Postgres (`packages/db/drizzle.config.ts`):** migraciones Drizzle configuradas sobre `DATABASE_URL_UNPOOLED` (conexión directa) y runtime en pooling (`DATABASE_URL` con `prepare: false` y `ssl: "require"`). Esquema de 14 tablas y extensiones `pg_trgm` / `unaccent` + índices GIN aplicados en Neon.
- **Neon Auth (`apps/api/src/lib/auth.ts`):** Better Auth preservado funcionando sobre Neon Postgres + soporte de verificación de Bearer JWT contra `NEON_AUTH_JWKS_URL` vía `jose`, expuesto en `GET /api/auth/providers` y `GET /api/health`.
- **Neon AI Gateway (`apps/api/src/routes/ai.ts`):** integración con `NEON_AI_GATEWAY_BASE_URL` y `NEON_AI_GATEWAY_TOKEN` mediante `@ai-sdk/openai`, con fallback automático a DeepSeek/OpenRouter/determinista si no hay créditos activos en el Gateway, y endpoint de estado `GET /api/ai/status`.
- **Neon Realtime (`apps/api/src/lib/realtime.ts`, `apps/web/src/hooks/useRealtimeStoreRequests.ts`, `SuggestStoreModal.tsx`):** consultas SQL en vivo selladas en el servidor (`GET /api/realtime/store-requests`, solo columnas públicas sin PII), `txid` en `POST /api/store-requests` y suscripción WebSocket en vivo con renovación automática y badge *«En vivo»* en el modal de sugerencias de tiendas.

## [0.5.5] - 2026-11-22

### 14ª Tienda Activa: Sony Store PA (`store.sony.com.pa`)
- **Nuevo adaptador VTEX oficial (`packages/scraper/src/adapters/sonypa.ts` + generalización `createVtexStoreAdapter` en `lgshoppa.ts`):** indexa el catálogo oficial de Sony Panamá (TVs BRAVIA, PlayStation 5, audífonos WH/WF, cámaras Alpha y audio) con normalización de códigos de modelo (ej. `K-65S20M2`, `WF-C710N`, `MDR-3R`) y URLs canónicas verificadas HTTP 200 (`/<slug>/p`).
- **Soporte transversal (14 tiendas):** agregada `sonypa` a `PANAMA_STORES` (`@regateo/shared`), alias de detección `alreadyMonitored` en `POST /api/store-requests` (`Sony`, `Sony Store`, `Sony Panamá`, `store.sony.com.pa`) y texto dinámico en `StoresDashboard.tsx`, `HeroSearch.tsx`, `App.tsx` y **Regateo AI**.

## [0.5.4] - 2026-11-22

### 4 Nuevas Tiendas Activas en Panamá (13 Tiendas Monitoreadas · +16,700 Listings)
- **4 nuevos adaptadores rápidos 100% JSON (`packages/scraper/src/adapters/`):**
  - **Raenco (`raenco.ts`):** Magento 2 GraphQL enfocado en los 6 departamentos de electrónica/línea blanca (`1,644` listings reales indexados).
  - **PlayNTrade (`pntpanama.ts`):** REST API oficial gaming `/api/v6.2.7/products` con selector inteligente de precios completos (evitando abonos de reserva) y URLs canónicas `/products/:sku/:slug` (`322` listings reales de consolas, controles y juegos).
  - **Samsung Shop PA (`samsungpa.ts`):** Magento 2 GraphQL oficial (`Store: pa`) con normalización de sufijos `-PA` para emparejamiento multi-tienda (`300` listings oficiales Samsung Panamá).
  - **LG Shop PA (`lgshoppa.ts`):** VTEX Catalog Search REST con EAN/GTIN oficial de 13 dígitos (`246` listings oficiales LG Panamá).
- **Tests y cobertura:** nueva suite `packages/scraper/src/sprint7-stores.test.ts` (**195/195 tests PASS** en `@regateo/scraper`).
- **Backend y Frontend dinámicos para 13 tiendas:** `PANAMA_STORES` (`@regateo/shared`), Regateo AI (`apps/api/src/routes/ai.ts`), detección de alias `alreadyMonitored` en `POST /api/store-requests` (`Raenco`, `Play N Trade`, `PNT`, `Samsung Shop`, `LG Shop`), y marquee/contadores dinámicos en `HeroSearch.tsx`, `StoresDashboard.tsx` y `App.tsx`.

## [0.5.3] - 2026-11-22

### 9ª Tienda Activa (eVision Store) y Sugerencias de Tiendas por la Comunidad
- **Nueva tienda monitoreada — eVision Store (`evisionstore.com`):** agregada a `PANAMA_STORES` (`@regateo/shared`), nuevo adaptador `packages/scraper/src/adapters/evisionstore.ts` (motor principal sobre índice público Algolia con pacer anti-rate-limit + URLs canónicas verificadas `/products/<slug>` + fallback HTML Botble con Cheerio) y suite de tests `evisionstore.test.ts`. Primer barrido completado con **852 listings reales indexados** y **153 emparejamientos multi-tienda** con las otras 8 tiendas de Panamá.
- **Sistema híbrido de sugerencias de tiendas (`store_requests`):**
  - Nueva tabla `store_requests` en PostgreSQL (`packages/db/src/schema.ts`) con deduplicación por clave normalizada y contador de votos comunitarios (`votes`).
  - Nuevos endpoints `POST /api/store-requests` (detección de tiendas ya monitoreadas, suma automática de votos `+1`, rate-limit, honeypot anti-bot y notificación opcional vía Resend si `SUPPORT_EMAIL` está configurado) y `GET /api/store-requests/popular` (público cacheado, sin exponer correos personales conforme a Ley 81), más métricas `openStoreRequestsCount` y `topStoreRequests` en `GET /api/admin/analytics`.
  - Nuevo modal lazy `SuggestStoreModal.tsx` en `apps/web` con sección en vivo *«Más pedidas por la comunidad»* (voto `+1` en 1 clic), formulario rápido de 10 segundos y enlace secundario directo a `soporte@regateo.pa`, accesible desde el Hero, *Tiendas y Radar*, estado vacío de búsqueda y Footer.

## [0.5.2] - 2026-11-22

### Búsqueda Inteligente por Coincidencia y Relevancia (Producto Principal Primero)
- **Motor de intención, sinónimos de Panamá y tolerancia a typos (`apps/api/src/services/catalog/search-intent.ts`):** expansión automática de sinónimos/abreviaturas (`televisión`/`tele` → `televisor`/`Smart TV`, `ps5`/`pc5`/`play 5` → `PlayStation 5`/`PlayStation®5` con borde de palabra `\m...\M` para evitar falsos positivos como `MY-PS555`, `nevera`/`refri` → `refrigeradora`, `parlante` → `bocina`, `ventilador` ↔ `abanico`, `air fryer` → `freidora de aire`, etc.), corrección de errores de escritura frecuentes (`sansung`, `labadora`, `televizor`, `aifon`) y fallback fuzzy automático con `pg_trgm` (`word_similarity`).
- **Clasificación por niveles Producto Principal vs Accesorio/Repuesto en TODOS los ordenamientos (`shared.ts`, `search.ts`, `ai-tools.ts`):** al buscar consolas (`PS5`), equipos (`aire acondicionado`, `televisor`, `laptop`, `lavadora`, `nevera`) u otros dispositivos principales, los productos principales siempre aparecen primero —incluso en **Mayor ahorro (`best-savings`)** y **Menor precio (`price-asc`)**—, bajando accesorios, repuestos, garantías y artículos *"para X"* / *"compatible con X"* (soportes, filtros, controles, auriculares, mangueras). Si el usuario pide explícitamente un accesorio (`audífonos ps5`, `control ps5`, `soporte aire acondicionado`), el accesorio lidera los resultados.
- **UX de búsqueda y optimizaciones React (`apps/web` — Vercel React Best Practices):** feedback discreto de coincidencias expandidas/aproximadas (`meta.search`), debounce sin condiciones de carrera + `startTransition`, hoisting de fallbacks estáticos, `content-visibility: auto` en tarjetas y suscripción derivada en `ProductCard`.
- **Verificación automatizada (`apps/api/scripts/verify-search-quality.ts`):** suite de calidad de búsqueda de solo lectura contra datos reales de Panamá.

## [0.5.1] - 2026-11-21

### Identidad visual "Regateo" y Mascota Interactiva en el Hero
- **Rebrand a "Regateo":** eliminada la palabra "App" del nombre visible de marca en Header, Footer, metadatos HTML/OG, PWA (`manifest.webmanifest`), páginas SEO (`/p/:slug`, `/c/:category`, `/tienda/:slug`), correos de alertas/recuperación y Regateo AI.
- **Nuevo logo oficial optimizado (`logo-mark.webp`, `favicon.png`, `logo-192.png`, `logo-512.png`):** extracción con transparencia limpia desde `logo.jpg` (14.4 KB WebP para carga instantánea en 4G) aplicado en Header, Footer, favicon e íconos PWA.
- **Mascota interactiva reactiva por categoría (`HeroMascotStage.tsx` + `mascota-hero.webp`):** ubicada junto al buscador del Hero con transparencia recortada al contorno (53.4 KB WebP), animación de levitación GPU-composited, inclinación 3D spring al puntero, globo de diálogo dinámico (reactivo tanto a la categoría activa como a lo que escribe el usuario en el buscador), badge flotante sobre el dedo señalando la categoría seleccionada, dock rápido de categorías y modo compacto móvil (respetando `prefers-reduced-motion`).

## [0.5.0] - 2026-11-21

### Fase 3 — Confianza Avanzada, Distribución SEO, Retención y PWA
- **Detector de descuentos falsos + "¿Compro ahora o espero?" (`insights.ts` + `ProductDetailModal.tsx`):** análisis honesto del historial real (`daysTracked`, mínimo/promedio, detección de descuentos sospechosos sin respaldo histórico) + botón 1-clic **Compartir por WhatsApp**.
- **Guías automáticas de compra en Panamá (`GET /api/guides` + `GuidesView.tsx`):** 4 guías vivas generadas desde datos en stock (*Mejores Smart TV 55"*, *Laptops bajo $700*, *Celulares comparados*, *Línea Blanca en oferta*), accesibles en `?vista=guias` desde Header y Footer.
- **SEO ampliado (`/c/:category`, `/tienda/:slug` + `sitemap.xml`):** páginas SSR con Open Graph y JSON-LD `CollectionPage`/`ItemList` sumadas a `/p/:slug`.
- **Analítica interna de negocio (`GET /api/admin/analytics`):** protegida con `CRON_SECRET` — clics salientes por tienda, top productos clicados, búsquedas más frecuentes, búsquedas sin resultado y reportes abiertos.
- **Resumen semanal y canal de ofertas (`packages/scraper/src/digest.ts`):** generador de posts de ofertas verificadas para canal WhatsApp/Telegram y digest semanal de bajadas en favoritos.
- **PWA instalable segura (`manifest.webmanifest` + `sw.js`):** instalable en móvil sin cachear jamás `/api/` ni `/out/`.
- **Suite de tests ampliada (`phase3.test.ts` + `matching.test.ts`):** 140+ tests automatizados pasando en `bun test`.

## [0.4.0] - 2026-11-21

### Fase 2 — Escalabilidad, Auth Completa, Cobertura y UX
- **Fix visual en `ProductCard.tsx`:** reubicada la banda/badge **"Ahorras $X"** debajo de los controles superiores para eliminar por completo el solapamiento con el botón **"Comparar"** y `♥`.
- **Columnas materializadas en PostgreSQL (`products`):** `best_price_cents`, `highest_price_cents`, `savings_cents`, `savings_percent`, `store_discount_cents`, `store_discount_percent`, `store_count` e `in_stock_count` indexadas y refrescadas automáticamente vía `refreshProductAggregates()` (+ columna `color` en `store_listings` con **5,195 listings** enriquecidos).
- **Motor de candidatos multi-tienda (`candidates.ts`) + 117 tests (`bun test`):** sube cobertura de comparación verificada (`611` productos multi-tienda, `429` comparables en stock) con **117/117 tests PASS**.
- **Auth completa:** recuperación de contraseña (`sendResetPassword` vía Resend + flujo UI `¿Olvidaste tu contraseña?` / `?resetToken=...`) y soporte **Google OAuth** (`GET /api/auth/providers`).
- **Calculadora "¿Conviene traerlo de Amazon a Panamá?"** (`packages/shared/src/import-calculator.ts` + tarjeta interactiva en `ProductDetailModal.tsx`) + chips de color y especificaciones técnicas.
- **Refactors modulares y calidad:** `catalog.ts` dividido en `catalog/{shared,search,similar,ai-tools}.ts`, `AccountSpaceView.tsx` dividido en `account/{FavoritesTab,ListsTab,AlertsTab}.tsx`, e incorporación de **Biome** (`bun run lint`) al repo y al CI.

## [0.3.0] - 2026-11-21

### Corregido y Agregado (Auditoría Crítica Pre-Black Friday)
- **Verdad del precio y stock:** `bestPriceCents` y `highestPriceCents` calculados solo sobre listings `in_stock = true`; separación estricta entre ahorro verificable entre tiendas (`savingsPercent <= 99%`) y descuento anunciado por tienda (`storeDiscountPercent <= 65%`); orden por defecto `most-stores` (y `relevance` al buscar) eliminando descuentos imposibles de portada; texto honesto en el Hero (`productos monitoreados` + `comparados en 2+ tiendas`); sellos de frescura y estado `Agotado`.
- **Alertas reales y privadas:** motor post-barrido (`packages/scraper/src/alerts.ts`) con envío vía Resend + escritura de `last_triggered_at`; cierre del endpoint público `GET /api/alerts?email=` (`401` sin sesión); doble opt-in en `POST /api/alerts` + `GET /api/alerts/confirm`.
- **Seguridad endurecida:** `Ratelimit` de Upstash por bucket con límite/ventana propios; IP de proxy confiable (`cf-connecting-ip`/`x-real-ip`); fail-fast de `BETTER_AUTH_SECRET` en producción; bloqueo de rol `system` y tope diario en Regateo AI; cero voseo argentino en toda la plataforma.
- **Cobertura, tests y CI:** inferencia de marca por familia (*iPhone → Apple*, *Galaxy → Samsung*, *Bravia → Sony*, etc.), eliminación de color/ruido comercial de claves, soporte GTIN/barcode, marcado automático de listings no vistos como agotados, **87 tests automatizados (`bun test`)**, workflow **`.github/workflows/ci.yml`** y barrido **diario** (`0 8 * * *`).
- **SEO, medición y UX:** rutas `/out/:listingId` (`302` + tabla `outbound_clicks`), `POST /api/reports` (*"Reportar precio incorrecto"*), `GET /sitemap.xml`, `GET /robots.txt`, páginas SEO `/p/:slug` con Open Graph + JSON-LD `AggregateOffer`, búsqueda con `unaccent` + `pg_trgm` `similarity()`, facetas independientes y filtros completos en URL con `pushState`/`popstate` para botón Atrás móvil.

## [0.2.0] - 2026-11-21

### Agregado
- **8 tiendas panameñas reales indexadas (+13,300 listings):** Panafoto, Almacenes Titán, Multimax, Rodelag, Yoytec, PTYTEC, Photura y Do it Center (removidas Audiofoto y Foto Sonido PTY por no publicar catálogo con precios en web).
- **Catálogo completo sin tope de 200:** paginación completa con backoff cortés, índices `pg_trgm` GIN en PostgreSQL y búsqueda por nombre, marca, modelo, SKU (`external_id`) y título de tienda.
- **Comparación de productos similares entre tiendas:** nuevo endpoint `GET /api/products/:slug/similar` y sección interactiva *"Alternativas similares en otras tiendas de Panamá"* dentro del detalle de producto.
- **Mi Espacio (experiencia de usuario logueado):** tablas `user_favorites`, `user_lists`, `user_list_items`, API `/api/me/*` con Better Auth, radar de bajadas de precio desde que guardaste, listas de compra con presupuesto optimizado entre tiendas, gestor de alertas y sincronización automática de favoritos de invitado.
- **5 componentes ultraligeros de Magic UI:** `NumberTicker`, `Marquee`, `BorderBeam`, `ShimmerButton` y `BlurFade` (0 WebGL/canvas, code-splitting con `React.lazy`).
- **Seguridad anti-bot / CAPTCHA:** soporte para Cloudflare Turnstile en producción + desafío HMAC-SHA256 anti-replay y honeypot en local, protegiendo registro, inicio de sesión y creación de alertas.
- **Política de Privacidad (Ley 81 de 2019 — Panamá):** vista dedicada `?vista=privacidad`, derechos ARCO, consentimiento obligatorio en registro y footer legal.
- **Radar interno blindado:** removido el disparo público de scraping desde la web; agregado `scripts/scrape-radar.ts` (`bun run scrape:radar`) y `POST /api/cron/invalidate-cache` protegido con `CRON_SECRET`.
- **DeepSeek AI en vivo:** integración directa con DeepSeek (`deepseek-chat`) vía Vercel AI SDK con streaming SSE y tool calls reales contra PostgreSQL.

### Corregido
- **Matcher estricto multi-tienda:** corregidas las fusiones erróneas por marca + tamaño (como *Sony BRAVIA 8 OLED 65"* vs *BRAVIA 2 LED 65"*) añadiendo diferenciación por modelo/serie/panel y guardrail de ratio de precio (>2.2x).

## [0.1.0] - 2026-11-21

### Agregado
- Monorepo inicial Turborepo + Bun (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/scraper`).
- Esquema inicial PostgreSQL + Drizzle ORM + Better Auth + migración `pgvector` HNSW.
- Automatización programada cada 3–5 días (scheduler Bun + GitHub Actions).
