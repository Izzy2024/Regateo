# Changelog — RegateoApp

Todos los cambios relevantes del proyecto se documentan aquí siguiendo [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

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
