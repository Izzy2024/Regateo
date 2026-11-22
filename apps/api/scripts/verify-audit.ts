// ============================================================================
// Verificación de la auditoría crítica (Sprint 5) contra app.request real:
// cierre de GET /api/alerts (401), verdad del precio (savingsPercent <= 99,
// bestStore en stock), doble opt-in + confirmación, /out/:listingId 302,
// /api/reports 201, sitemap XML válido, /p/:slug con JSON-LD AggregateOffer,
// búsqueda unaccent, facetas independientes y meta.comparableCount.
// Ejecutar: bun scripts/verify-audit.ts
// ============================================================================
import { app } from "../src/app";
import { db, sql } from "@regateo/db";

const TEST_EMAIL = `audit-test-${Date.now()}@regateo.test`;
let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}
async function captchaHeaders(): Promise<Record<string, string>> {
  const res = await app.request("/api/security/captcha");
  const body = (await res.json()) as any;
  const match = body.challenge.question.match(/(\d+) \+ (\d+)/);
  return {
    "x-captcha-token": body.challenge.token,
    "x-captcha-answer": String(Number(match[1]) + Number(match[2])),
  };
}

// 1) Cierre de fuga: GET /api/alerts?email=... SIN sesión → 401 ------------
const leakRes = await app.request(`/api/alerts?email=${TEST_EMAIL}`);
const leakBody = (await leakRes.json()) as any;
check(
  "GET /api/alerts?email=... SIN sesión → 401 (Ley 81)",
  leakRes.status === 401 && leakBody.error === "unauthorized",
  { status: leakRes.status, body: leakBody }
);
const noEmailRes = await app.request("/api/alerts");
check("GET /api/alerts sin sesión (sin email) → 401", noEmailRes.status === 401);

// 2) Verdad del precio -------------------------------------------------------
const listRes = await app.request("/api/products?limit=24");
const listBody = (await listRes.json()) as any;
check("GET /api/products 200", listRes.status === 200);
check("meta.comparableCount presente", typeof listBody.meta.comparableCount === "number", listBody.meta);
check(
  "savingsPercent <= 99 en todos los items",
  listBody.items.every((item: any) => item.savingsPercent <= 99),
  listBody.items.filter((i: any) => i.savingsPercent > 99)
);
check(
  "storeDiscountCents/Percent presentes (0..65% o 0)",
  listBody.items.every(
    (item: any) =>
      typeof item.storeDiscountCents === "number" &&
      typeof item.storeDiscountPercent === "number" &&
      item.storeDiscountPercent <= 65
  )
);
const withOtherStores = listBody.items.filter((i: any) => i.storeCount > 1);
if (withOtherStores.length > 0) {
  const item = withOtherStores[0];
  check(
    "listings ordenados: en stock primero, luego precio asc",
    item.listings.every(
      (listing: any, idx: number) =>
        idx === 0 ||
        (item.listings[idx - 1].inStock && !listing.inStock) ||
        (item.listings[idx - 1].inStock === listing.inStock &&
          item.listings[idx - 1].priceCents <= listing.priceCents)
    ),
    item.listings.map((l: any) => `${l.inStock ? "S" : "-"}/${l.priceCents}`)
  );
  check(
    "bestStore.listingId + inStock presentes",
    typeof item.bestStore.listingId === "string" && typeof item.bestStore.inStock === "boolean",
    item.bestStore
  );
}
// Un producto agotado en la tienda más barata nunca gana si otra tiene stock
const partialStock = (await (
  await app.request("/api/products?limit=50&multiStoreOnly=true")
).json()) as any;
const mixedStockItem = partialStock.items.find(
  (i: any) => i.inStockCount > 0 && i.storeCount > i.inStockCount
);
if (mixedStockItem) {
  check(
    "bestStore.inStock = true cuando hay stock en alguna tienda",
    mixedStockItem.bestStore.inStock === true,
    { slug: mixedStockItem.slug, bestStore: mixedStockItem.bestStore }
  );
}

// 3) Búsqueda unaccent + facetas independientes ------------------------------
const accentedCandidates = await db
  .select({ name: sql<string>`canonical_name`, slug: sql<string>`slug` })
  .from(sql`products`)
  .where(sql`canonical_name ~ '[ÁÉÍÓÚáéíóúñ]'`)
  .limit(5) as any[];
console.log(`   candidatos con acento: ${accentedCandidates.map((r: any) => r.name.slice(0, 30)).join(" | ")}`);
if (accentedCandidates.length > 0) {
  const candidate = accentedCandidates[0];
  // Tomar una palabra con acento del nombre y buscarla SIN acento
  const accentedWord = (candidate.name.match(/[A-Za-zÁÉÍÓÚáéíóúñ]+/g) ?? []).find(
    (w: string) => /[ÁÉÍÓÚáéíóúñ]/.test(w)
  );
  if (accentedWord) {
    const plainWord = accentedWord
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ñ/gi, "n")
      .toLowerCase();
    const searchRes = await app.request(`/api/products?q=${encodeURIComponent(plainWord)}&limit=24`);
    const searchBody = (await searchRes.json()) as any;
    // La prueba real del brief: buscar SIN tilde encuentra nombres CON tilde
    const accentedWordPattern = new RegExp(accentedWord, "i");
    const found = searchBody.items.some((i: any) => accentedWordPattern.test(i.canonicalName));
    check(
      `unaccent: "${plainWord}" (sin tilde) encuentra productos "${accentedWord}…" (con tilde)`,
      searchRes.status === 200 && found,
      { results: searchBody.items.map((i: any) => i.canonicalName.slice(0, 40)).slice(0, 3) }
    );
  } else {
    check("unaccent: candidato con palabra acentuada (skip)", true);
  }
} else {
  check("unaccent: sin datos acentuados en DB (skip)", true);
}

const catFilterRes = await app.request("/api/products?limit=1&category=televisores");
const catFilterBody = (await catFilterRes.json()) as any;
check(
  "faceta de categorías NO desaparece al filtrar por category",
  catFilterBody.facets.categories.length > 1 &&
    catFilterBody.facets.categories.some((f: any) => f.key !== "televisores"),
  catFilterBody.facets.categories.map((f: any) => `${f.key}:${f.count}`)
);
const storeFilterRes = await app.request("/api/products?limit=1&store=multimax");
const storeFilterBody = (await storeFilterRes.json()) as any;
check(
  "faceta de tiendas NO desaparece al filtrar por store",
  storeFilterBody.facets.stores.length > 1,
  storeFilterBody.facets.stores.map((f: any) => `${f.slug}:${f.count}`)
);
const relevanceRes = await app.request("/api/products?q=tv&limit=5&sort=relevance");
const relevanceBody = (await relevanceRes.json()) as any;
check(
  "sort=relevance responde (pg_trgm similarity)",
  relevanceRes.status === 200 && relevanceBody.items.length > 0,
  relevanceBody.items.map((i: any) => i.slug)
);
check(
  "relevancia penaliza accesorios al buscar 'tv'",
  !relevanceBody.items.some((i: any) => i.category === "accesorios"),
  relevanceBody.items.filter((i: any) => i.category === "accesorios").map((i: any) => i.slug)
);

// 4) /out/:listingId → 302 + click registrado --------------------------------
const outListBody = (await (await app.request("/api/products?limit=1&multiStoreOnly=true")).json()) as any;
const listing = outListBody.items[0]?.listings?.[0];
const outRes = await app.request(`/out/${listing.id}?src=card-test`);
check(
  "GET /out/:listingId → 302 con Location http(s)",
  outRes.status === 302 && /^https?:\/\//i.test(outRes.headers.get("location") ?? ""),
  { status: outRes.status, location: outRes.headers.get("location") }
);
await new Promise((resolve) => setTimeout(resolve, 300));
const [clickRow] = await db
  .select({ source: sql<string>`source`, storeSlug: sql<string>`store_slug` })
  .from(sql`outbound_clicks`)
  .where(sql`listing_id = ${listing.id}`) as any[];
check(
  "clic registrado en outbound_clicks con source",
  clickRow?.source === "card-test" && Boolean(clickRow?.storeSlug),
  clickRow
);
const outNotFound = await app.request("/out/00000000-0000-4000-8000-000000000000");
check("GET /out inexistente → 404", outNotFound.status === 404);

// 5) POST /api/reports → 201 ---------------------------------------------------
const reportRes = await app.request("/api/reports", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    productId: outListBody.items[0].id,
    listingId: listing.id,
    reason: "wrong-price",
    details: "El precio en la tienda no coincide",
  }),
});
const reportBody = (await reportRes.json()) as any;
check("POST /api/reports → 201 { ok, id }", reportRes.status === 201 && reportBody.ok === true && typeof reportBody.id === "string", reportBody);
const badReport = await app.request("/api/reports", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    productId: outListBody.items[0].id,
    listingId: listing.id,
    reason: "no-existe",
  }),
});
check("POST /api/reports razón inválida → 400", badReport.status === 400);

// 6) Doble opt-in + confirmación -----------------------------------------------
const alertRes = await app.request("/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json", ...(await captchaHeaders()) },
  body: JSON.stringify({
    productId: outListBody.items[0].id,
    email: TEST_EMAIL,
    targetPriceCents: Math.round(outListBody.items[0].bestPriceCents * 0.5),
  }),
});
const alertBody = (await alertRes.json()) as any;
check(
  "alerta invitada 201 con requiresConfirmation + confirmUrl (dev)",
  alertRes.status === 201 &&
    alertBody.requiresConfirmation === true &&
    typeof alertBody.confirmUrl === "string" &&
    alertBody.alert.verified === false,
  alertBody
);
const [guestRow] = await db
  .select({ verified: sql<boolean>`verified`, confirmToken: sql<string>`confirm_token` })
  .from(sql`price_alerts`)
  .where(sql`id = ${alertBody.alert.id}`) as any;
check("fila invitada: verified=false + confirm_token presente", guestRow?.verified === false && Boolean(guestRow?.confirmToken));

const confirmUrl = new URL(alertBody.confirmUrl);
const confirmRes = await app.request(`${confirmUrl.pathname}${confirmUrl.search}`);
check(
  "GET /api/alerts/confirm → 200 HTML amigable",
  confirmRes.status === 200 &&
    (confirmRes.headers.get("content-type") ?? "").includes("text/html") &&
    (await confirmRes.text()).includes("Alerta confirmada"),
  confirmRes.status
);
const [confirmedRow] = await db
  .select({ verified: sql<boolean>`verified`, confirmedAt: sql<string>`confirmed_at` })
  .from(sql`price_alerts`)
  .where(sql`id = ${alertBody.alert.id}`) as any;
check("alerta verificada + confirmedAt en DB", confirmedRow?.verified === true && Boolean(confirmedRow?.confirmedAt));
const reuseConfirm = await app.request(`${confirmUrl.pathname}${confirmUrl.search}`);
check("reusar el token de confirmación → 404", reuseConfirm.status === 404);

// 7) SEO: sitemap, robots, /p/:slug -------------------------------------------
const sitemapRes = await app.request("/sitemap.xml");
const sitemapText = await sitemapRes.text();
check(
  "GET /sitemap.xml → 200 XML válido con productos y categorías",
  sitemapRes.status === 200 &&
    (sitemapRes.headers.get("content-type") ?? "").includes("xml") &&
    sitemapText.startsWith("<?xml") &&
    sitemapText.includes("<urlset") &&
    sitemapText.includes("/p/") &&
    sitemapText.includes("categoria="),
  { status: sitemapRes.status, head: sitemapText.slice(0, 120) }
);
const robotsRes = await app.request("/robots.txt");
const robotsText = await robotsRes.text();
check(
  "GET /robots.txt → 200 con Sitemap y Disallow /api/",
  robotsRes.status === 200 && robotsText.includes("Sitemap:") && robotsText.includes("Disallow: /api/"),
  robotsText
);
const seoRes = await app.request(`/p/${outListBody.items[0].slug}`);
const seoHtml = await seoRes.text();
check(
  "GET /p/:slug → 200 HTML SEO-ready",
  seoRes.status === 200 &&
    (seoRes.headers.get("content-type") ?? "").includes("text/html") &&
    seoHtml.includes("<title>") &&
    seoHtml.includes('meta name="description"') &&
    seoHtml.includes('property="og:title"') &&
    seoHtml.includes('property="og:image"'),
  seoRes.status
);
check(
  "JSON-LD Product + AggregateOffer (lowPrice/highPrice/offerCount/USD)",
  seoHtml.includes('"AggregateOffer"') &&
    seoHtml.includes('"lowPrice"') &&
    seoHtml.includes('"highPrice"') &&
    seoHtml.includes('"offerCount"') &&
    seoHtml.includes('"priceCurrency":"USD"'),
  seoHtml.match(/AggregateOffer[^}]{0,200}/)?.[0]
);
check(
  "enlace limpio a la SPA (?producto=slug)",
  seoHtml.includes(`?producto=${encodeURIComponent(outListBody.items[0].slug)}`)
);
const seoNotFound = await app.request("/p/no-existe-xyz");
check("GET /p/:slug inexistente → 404 HTML", seoNotFound.status === 404);

// 8) Limpieza -----------------------------------------------------------------
await db.execute(sql`delete from price_alerts where email = ${TEST_EMAIL}`);
await db.execute(sql`delete from price_reports where listing_id = ${listing.id}`);
await db.execute(sql`delete from outbound_clicks where listing_id = ${listing.id}`);
const [alertLeft] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`price_alerts`)
  .where(sql`email = ${TEST_EMAIL}`) as any;
const [reportLeft] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`price_reports`)
  .where(sql`listing_id = ${listing.id}`) as any;
const [clickLeft] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`outbound_clicks`)
  .where(sql`listing_id = ${listing.id}`) as any;
check(
  "cleanup completo (0 alertas/reportes/clics de prueba)",
  (alertLeft?.total ?? 1) === 0 && (reportLeft?.total ?? 1) === 0 && (clickLeft?.total ?? 1) === 0
);

console.log(
  failures === 0
    ? "\n🎉 AUDITORÍA: TODAS LAS VERIFICACIONES PASARON"
    : `\n💥 ${failures} verificaciones fallaron`
);
process.exit(failures === 0 ? 0 : 1);
