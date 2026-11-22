# `@regateo/scraper` — Motor de scraping de tiendas panameñas

Indexa productos reales de electrónica, cómputo, línea blanca y audio de las tiendas de
Panamá, y los agrupa por modelo para poder comparar precios entre tiendas.

## Contrato público

```ts
import {
  ensureStoresSeeded,
  runScrapePipeline,
  type ScrapeRunSummary,
} from "@regateo/scraper";

await ensureStoresSeeded();
const summaries: ScrapeRunSummary[] = await runScrapePipeline({
  stores: ["multimax", "panafoto"], // opcional
  maxPerStore: 5000,                // default 5000 (máx 20000, --full)
  useFirecrawl: true,               // default true
});
```

`runScrapePipeline` nunca lanza por una tienda individual: cada tienda falla de forma
aislada y queda registrada en `scrape_runs` con `status = "failed"` y `error_message`.

## Motores por tienda (8 adaptadores activos)

El registro vive en `src/adapters/index.ts` y expone **exactamente estos 8 slugs**:

| # | Tienda | Slug | Plataforma | Motor | Fuente real |
| --- | --- | --- | --- | --- | --- |
| 1 | Panafoto | `panafoto` | Magento 2 | `magento-graphql` (+ `magento-search`) | `POST /graphql` (`products(search:"", pageSize:100)`), más búsqueda por modelo para enriquecer comparaciones |
| 2 | Almacenes Titán | `titan` | Shopify | `shopify-json` | `/collections/<handle>/products.json` + barrido global `/products.json` |
| 3 | Multimax | `multimax` | Shopify | `shopify-json` | `/collections/<handle>/products.json` + barrido global `/products.json` |
| 4 | Rodelag | `rodelag` | Shopify | `shopify-json` | `/collections/<handle>/products.json` + barrido global `/products.json` |
| 5 | Yoytec | `yoytec` | Odoo eCommerce | `http-cheerio` | `/shop?page=N` (48 tarjetas/página, microdata + `oe_currency_value`) |
| 6 | PTYTEC | `ptytec` | SPA + Laravel API | `json-api` | `https://webapi.ptytec.com/api/product/search?page=N` |
| 7 | Photura | `photura` | Shopify | `shopify-json` | `/collections/<handle>/products.json` + barrido global `/products.json` |
| 8 | Do it Center | `doitcenter` | Magento 2 + Next.js | `magento-graphql` | `/_next/data/<buildId>/categorias/...json?page=N` (payload GraphQL SSR) |

Notas por adaptador:

- **Shopify** (Titán, Multimax, Rodelag, Photura): pagina cada colección configurada y
  luego hace un barrido secuencial de `/products.json` con pausas de 400 ms y backoff
  exponencial ante HTTP 429/`local_rate_limited`; todo pasa por
  `isRelevantElectronicsProduct` para descartar juguetes, ropa y muebles.
- **Panafoto**: además del catálogo completo, ejecuta `magento-search` para buscar por
  código de modelo los productos que otras tiendas ya tienen (queda registrado como su
  propia fila en `scrape_runs`).
- **PTYTEC**: usa el campo `model` de su API como modelo confiable (`trustSkuModel`
  desactivado); Do it Center deriva el modelo del SKU (`51858Q6QV` → `58Q6QV`) y Yoytec
  usa SKUs internos (`COM-MJK-G15`), por lo que tampoco confía en el SKU crudo.

Cadena de degradación de Firecrawl (`src/firecrawl-client.ts`):

1. `@mendable/firecrawl-js` con `FIRECRAWL_API_KEY` o `FIRECRAWL_API_URL` (self-hosted).
2. CLI `firecrawl` autenticado en la máquina (`--format html,links,markdown`).
3. HTTP directo + Cheerio (Panafoto tiene fallback propio de HTML Magento).

El pipeline **nunca se cae** por Firecrawl: si se agota la cuota se marca
`quotaExhausted` y se continúa por HTTP. Los límites de rate (12 req/min del CLI) se
respetan con pacing (`FIRECRAWL_MIN_INTERVAL_MS`, default 6000 ms) y un reintento.

## Matching estricto multi-tienda

`src/matching.ts` decide si dos listings de tiendas distintas son **el mismo producto**.
La regla de oro: *ante la duda, no fusionar* (se muestran como “alternativas similares”).

### Regla 0 — Familia de marca cuando la tienda omite el fabricante

`inferBrandFromFamily()` reconoce las familias que Panamá escribe sin marca
(`iPhone 17`, `Galaxy S25 FE`, `BRAVIA 8`, `IdeaPad`, `Vivobook`, `Inspiron`, …) y les
asigna Apple/Samsung/Sony/Lenovo/Asus/Dell/Acer/LG/Nintendo/Microsoft/Canon/Epson/Ninja.
Así `iPhone 17 512GB` de Panafoto deja de caer en `generic-panafoto::` y empata con
Multimax. El **vendor** de Shopify y la marca explícita del título siempre tienen
prioridad sobre la familia.

### Regla 1 — Solo un modelo exacto puede fusionar

- Se requiere el **código de modelo normalizado** (`QN55Q60D`, `15-FC0287LA`,
  `LRGN6325Z`, `WH-1000XM5`, `BN300`, `TS3610`, `DV22C6370PP`, `55Q6QV`…).
- **Prohibido** generar una llave compartida solo por marca + tamaño/capacidad:
  `sony::tv-65in`, `samsung::tv-55in`, `lg::lavadora-20kg`, `sankey::aire-12000btu`.
  Ejemplo real: **Sony BRAVIA 8 65" OLED ($1,499.95, SKU `155144`) y BRAVIA 2 65" LED
  ($459.99)** son productos distintos; jamás comparten `product_id`.
- Cuando no hay modelo real se usa una **firma de tokens** (hasta 12) que incluye marca y
  número de serie (`bravia-8` ≠ `bravia-2`); si falta la marca, la firma se limita a la
  tienda de origen para no colisionar con productos genéricos de otras tiendas.

### Regla 2 — Panel, serie y variantes dentro de la llave

Todo diferenciador presente en el título entra al `match_key` (`marca::modelo-<sufijo>`):

| Diferenciador | Ejemplo en la llave | Extracción |
| --- | --- | --- |
| Tamaño de pantalla | `-65in` | `65"`, `65 pulgadas`, monitores/proyectores/TV |
| Panel distintivo | `-oled`, `-qled`, `-qned`, `-miniled`, `-nanocell` | “LED” genérico se ignora (las tiendas lo omiten de forma inconsistente) |
| Serie (sin modelo) | `bravia-8`, `bravia-2`, `a15` | tokens numéricos cortos incluidos en la firma |
| Almacenamiento | `-512gb`, `-1024gb` | normalizado a GB (`1TB` → `1024gb`) |
| RAM | `-ram8gb`, `-ram16gb` | normalizado, se infiere de `8GB RAM` o `8GB 512GB` |
| Capacidad | `-20kg`, `-9-42pc` | kg / pies cúbicos |
| BTU | `-12000btu` | aires acondicionados |

Se guardan también en `products.specs` (`panelTechnology`, `screenSizeInches`, `storage`,
`ram`, `capacityKg`, `capacityCuFt`, `btu`, `color`, `gtin`) para auditoría.

### Claves canónicas de celulares (familias top)

- **iPhone**: `apple::iphone-<gen><tier>-<storage>` con tier `e | air | plus | pro |
  pro-max` y almacenamiento obligatorio. `iPhone 17 512GB` empata entre tiendas;
  `iPhone 17 Pro`, `iPhone 17 256GB` e `iPhone 16e` nunca se mezclan.
- **Samsung Galaxy S/A/Z**: `samsung::galaxy-<serie><gen>-<tier>-<storage>` con tier
  `fe | plus | ultra | flip | fold`. También reconoce `Samsung A17 128GB` sin la palabra
  Galaxy (con señales de teléfono). `Galaxy S25 FE 512GB` ≠ `Galaxy S25 256GB`.
- **Color y ruido comercial** (`negro`, `teal`, `titanio`, `midnight`, `SF`, `E-SIM`,
  `5G`, `liberado`, `dual sim`, …) se excluyen de la clave y el color queda en
  `specs.color`: todos los colores del mismo modelo/almacenamiento comparten producto.
- **GTIN/EAN/UPC**: si Shopify entrega `variant.barcode` (8–14 dígitos) se usa la clave
  `gtin::<digitos>`, que identifica el SKU exacto entre tiendas (siempre con el
  guardrail de precio 2.2x).

### Regla 3 — Guardrail de precio 2.2x (`src/ingest.ts`)

Antes de vincular un listing a un producto que ya tiene ofertas de **otra tienda**, se
compara el precio: si `max(p1, p2) / min(p1, p2) > 2.2`, **no se fusiona**. El listing
recibe un producto aislado con la llave determinista
`${matchKey}::${storeSlug}-${externalId}`. Esto corta cualquier falso positivo residual
incluso cuando dos tiendas comparten un código parcial ambiguo.

### Accesorios y ruido

- Accesorios (fundas, cables, tintas, soportes) van a un namespace `acc-`
  (`samsung::acc-a37`) para no comparar una funda de $9.95 con el teléfono.
- No se consideran modelo: SKUs de tienda (`PSN…`, EAN/UPC, ids numéricos), unidades
  (`9.42PC`, `700W`, `55"`), resoluciones (`1080P`), CPUs (`I5-1235U`, `R7-7730U`),
  voltajes (`100V-240V`), respuestas de panel (`1MS`), ratings IP (`IPX4`, `IP67`),
  generaciones (`GEN11`) ni ranuras (`M.2`).

### Limpieza de fusiones heredadas

`bun src/cleanup.ts` (desde `packages/scraper`) recorre la BD y separa cualquier producto
con llave familia antigua, ratio > 2.2, duplicados de la misma tienda, modelo ausente con
2+ tiendas, códigos detallados distintos o variantes divergentes; después repara la
metadata (`canonical_name`, marca, modelo, categoría, specs) de cada producto aislado a
partir del título real del listing.

## Candidatos multi-tienda (`src/candidates.ts`)

`bun --filter @regateo/scraper candidates` usa `pg_trgm.similarity()` (con fallback si
la extensión no está disponible) para proponer pares de productos de **tiendas
distintas** en `celulares`, `televisores` y `computadoras` que aún no empataron.

Solo auto-fusiona con precisión estricta:

- misma marca y categoría, ambos **no accesorios**, tiendas disjuntas;
- mismo `model_number` (o serie compartida si falta el modelo / GTIN idéntico);
- mismo almacenamiento, tamaño de pantalla (TV y laptops), panel y tier de
  iPhone/Galaxy (FE, Plus, Ultra, Pro Max…);
- ratio de precio **≤ 1.65** y similitud de título **≥ 0.35**.

Imprime pares pre-filtrados, fusiones aplicadas, motivos de rechazo y el salto de
cobertura por categoría; termina refrescando los agregados. Los embeddings con
`OPENAI_API_KEY`/`OPENROUTER_API_KEY` quedan como siguiente capa (la tabla ya tiene
`embedding_text`).

## Scripts internos (operación)

Se ejecutan **desde la raíz del repositorio** y nunca se exponen a visitantes públicos:
el scraping solo se dispara desde terminal, VPS, Render Cron o GitHub Actions.

| Comando | Implementación | Qué hace |
| --- | --- | --- |
| `bun run scrape:radar` | `scripts/scrape-radar.ts` | Operación interna del radar: barrido de todas las tiendas activas (hasta **6.000** relevantes por tienda), limpia la caché de la API (`POST /api/cron/invalidate-cache` con `CRON_SECRET` si `API_URL` responde) e imprime el snapshot de PostgreSQL (productos, listings y comparables por tienda). |
| `bun run scrape:full` | `scripts/scrape-radar.ts --full` | Igual que el anterior pero **sin techo práctico**: hasta **20.000** productos por tienda (catálogo completo real). |
| `bun run scrape:schedule` | `packages/scraper/src/scheduler.ts` | Daemon de automatización cada `SCRAPE_INTERVAL_DAYS` días (1..7, default **3**) a las **03:00 hora de Panamá** (08:00 UTC). Imprime la próxima corrida y soporta `--once` y `--run-now`. |
| `bun run scrape` | `packages/scraper/src/cli.ts` | CLI del paquete para corridas puntuales: `--stores=`, `--max=`, `--full`, `--no-firecrawl`, `--no-enrich`, `--json`. |
| `alerts:check` | `packages/scraper/src/alerts.ts` | Evalúa y despacha alertas sin re-scrapear (`bun --filter @regateo/scraper alerts:check`). |
| `candidates` | `packages/scraper/src/candidates.ts` | Descubre y fusiona candidatos multi-tienda de alta precisión (`pg_trgm`) y reporta cobertura. |
| `stats:refresh` | `packages/scraper/src/refresh-stats.ts` | Rematerializa `best_price_cents`, savings, store counts y descuentos. |
| `test` | `src/matching.test.ts` | Suite del matcher con `bun test` (117 tests: familias, iPhone/Galaxy, GTIN, candidatos, colores). |

Flags de `scrape:radar` / `scrape:full`:

```bash
bun run scrape:radar                        # todas las tiendas, hasta 6.000 c/u + flush de caché
bun run scrape:radar --quick                # barrido rápido de verificación (250 por tienda)
bun run scrape:radar --stores=panafoto      # una o varias tiendas (coma)
bun run scrape:radar --max=1500             # techo explícito por tienda
bun run scrape:radar --no-enrich            # sin búsqueda cruzada por modelo
bun run scrape:radar --no-firecrawl         # solo Shopify JSON / GraphQL / API / HTTP
bun run scrape:full                         # catálogo completo (hasta 20.000 por tienda)
```

Flags de `scrape:schedule`:

```bash
bun run scrape:schedule                     # daemon (muestra la próxima corrida)
bun run scrape:schedule --run-now           # corre ya y sigue como daemon
bun run scrape:schedule --once              # una sola corrida (cron externo / VPS)
bun run scrape:schedule --stores=doitcenter,yoytec --max=5000
```

CLI del paquete (equivale a `bun run scrape` desde la raíz):

```bash
bun run scrape --stores=titan,ptytec --max=2000
bun run scrape --full --no-enrich
bun run scrape --json                       # resumen JSON para CI
bun --filter @regateo/scraper typecheck
```

Mantenimiento puntual de datos (desde `packages/scraper`):

```bash
bun src/cleanup.ts                          # re-agrupa listings + color + agregados + reporte antes/después
bun src/candidates.ts                       # fusiona candidatos multi-tienda de alta precisión
bun src/refresh-stats.ts                    # rematerializa agregados de precio
bun test                                    # suite del matcher/candidatos (117 tests)
bun src/alerts.ts                           # evalúa y despacha alertas de precio
```

Workflows:

- `.github/workflows/scheduled-scrape.yml`: barrido **diario** (`cron 0 8 * * *`,
  03:00 Panamá) con `max_per_store: 5000` y despacho de alertas al final.
- `.github/workflows/ci.yml`: en `push`/`pull_request` a `main` ejecuta
  `bun install --frozen-lockfile`, `bun run typecheck`, **Biome**
  (`bun x biome check --diagnostic-level=error || true`), `bun test` y `bun run build`.

## Variables de entorno

| Variable | Default | Uso |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://admin@localhost:5432/regateoapp_dev` | destino de escritura |
| `FIRECRAWL_API_KEY` | — | Firecrawl Cloud (SDK) |
| `FIRECRAWL_API_URL` | — | Firecrawl self-hosted (SDK) |
| `FIRECRAWL_MIN_INTERVAL_MS` | `6000` | pacing entre llamadas Firecrawl |
| `SCRAPE_INTERVAL_DAYS` | `3` | cadencia del scheduler (1..7) |
| `SCRAPE_ENRICH_LIMIT` | `80` | modelos consultados en el enriquecimiento (0 = off) |
| `SCRAPE_STORE_TIMEOUT_MS` | `900000` | timeout por tienda (15 min) |
| `PTYTEC_API_URL` | `https://webapi.ptytec.com/api` | base del API de catálogo de PTYTEC |
| `API_URL` | `http://localhost:3001` | API que `scrape:radar` invalida tras el barrido |
| `CRON_SECRET` | — | autoriza `POST /api/cron/invalidate-cache` (si falta, solo avisa) |

## Persistencia

`src/ingest.ts` hace upsert en `products` (por `match_key`), `store_listings` (por
`store_id + external_id`), registra el snapshot real de hoy en `price_history` y
actualiza `stores.last_scraped_at`. **No se inventan históricos ni productos**: cada
punto de `price_history` corresponde a una observación real; se inserta cuando el precio
**o el stock** cambia, o cuando pasaron ≥12 h desde el último snapshot idéntico.

### Agregados materializados (`src/refresh-stats.ts`)

`refreshProductAggregates(productIds?)` ejecuta **una sola sentencia** `UPDATE products
... FROM (SELECT ... GROUP BY product_id)` y deja listos para consulta O(1):

| Columna | Cálculo |
| --- | --- |
| `best_price_cents` | `coalesce(min(price) filter in_stock, min(price))` |
| `highest_price_cents` | `coalesce(max(price) filter in_stock, max(price))` |
| `store_count` / `in_stock_count` | tiendas distintas / listings en stock |
| `savings_cents` | con 2+ tiendas en stock: `max_in_stock - min_in_stock` (nunca negativo) |
| `savings_percent` | `round(100 * savings / max_in_stock, 2)`, acotado a ≤99 |
| `store_discount_*` | descuento del listing ganador sobre su `original_price_cents` (0 si >65%) |

Se llama automáticamente al final de `ingestScrapedItems()`, de `cleanup.ts` y de
`candidates.ts`. También se puede forzar con `bun --filter @regateo/scraper
stats:refresh`. Los productos sin listings quedan en 0 (nunca `NULL`).

Además, `store_listings.color` se llena con `extractColor()` en cada ingesta y se
backfillea en el re-agrupamiento.

Reglas anti corrupción:

- **Metadata estable**: `canonical_name` no se sobreescribe con un nombre peor, `brand`,
  `model_number` e `image_url` usan `COALESCE`, y `products.updated_at` solo se toca
  cuando un precio o stock realmente cambió.
- **Barrido de agotados**: al final de una corrida completa (`items >= 50` y al menos 60%
  de los listings previos) se marca `in_stock = false` en los listings que la tienda ya
  no devuelve, con su snapshot de precio. Así no quedan “zombies” como Mejor Precio.

## Alertas de precio reales (`src/alerts.ts`)

Al terminar `runScrapePipeline()` se ejecuta `evaluateAndDispatchPriceAlerts()`:

1. Toma `price_alerts` con `active = true AND verified = true` y sin disparo en 24 h.
2. Cruza con la **mejor oferta en stock** de `store_listings` para ese producto.
3. Si `mejor precio <= target_price_cents`, envía correo HTML con Resend
   (`RESEND_API_KEY`, from `ALERTS_FROM_EMAIL`) con asunto
   `🔥 Bajó de precio: <producto> a $<precio> en <tienda>` y enlace
   `${API_URL}/out/<listingId>?src=alert`.
4. Sin `RESEND_API_KEY` (dev) registra `[ALERTA DISPARADA] ...` estructurado.
5. Actualiza `price_alerts.last_triggered_at`.

También puede ejecutarse solo con `bun --filter @regateo/scraper alerts:check`.

## Descubrimiento por tienda

- **Do it Center** no expone `/graphql` en el host público, pero cada página de categoría
  Next.js incrusta la respuesta GraphQL de Magento en `__NEXT_DATA__` y la publica en
  `/_next/data/<buildId>/...json?page=N` (≈85 KB en vez de ≈500 KB de HTML). El adaptador
  descubre categorías del menú, reutiliza el `buildId` vigente y cae a HTML/Firecrawl si
  rota. La lista no incluye `stock_status`, así que se marca `stockStatus: UNKNOWN` y se
  asume disponible (los productos se venden online).
- **Yoytec** es Odoo: el grid viene renderizado en el servidor (48 tarjetas/página) con
  microdata y `oe_currency_value`; el stock real aparece como badge `In Stock` / `Agotado`.
  Las categorías se descubren del menú `/shop/category/<id>` priorizando laptops,
  monitores, periféricos y componentes (con penalización a estantes de accesorios).
- **PTYTEC** es una SPA Vue cuyo bundle revela `webapi.ptytec.com/api`: `/category` para el
  árbol y `/product/search?category=<id>&page=N` (24/página) para el catálogo, con
  `regular_price`, `price_public`, `offer_price`, `stock` y `model` por producto. La URL
  pública verificable es `https://www.ptytec.com/product/<id>`.

## Notas de datos

- Catálogo completo: `scrape:full`/`--full` = `--max=20000`; el CLI usa 5.000 por defecto y
  `scrape:radar` 6.000. Panafoto se pagina con `products(search:"",
  pageSize:100)` (5.435 SKUs), Shopify pagina colecciones + barrido global de
  `/products.json` con pausas de 400 ms y backoff ante `local_rate_limited`, Do it Center
  pagina todas las páginas de sus categorías padre, Yoytec camina `/shop` completo y
  PTYTEC recorre las 244 páginas de su API.
- Las comparaciones multi-tienda se validan abriendo cada URL pública y comprobando que el
  precio almacenado coincide con el de la tienda.
