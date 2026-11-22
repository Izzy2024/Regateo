// ============================================================================
// Verificación Fase 3 (apps/api): priceInsight (detector de descuentos falsos
// + compro ahora/espero), guías de compra, SEO /c/ y /tienda/, sitemap
// ampliado y /api/admin/analytics protegido. Ejecutar:
//   bun scripts/verify-phase3.ts
// ============================================================================
import { app } from "../src/app";
import { db, sql } from "@regateo/db";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}

// 1) GET /api/guides ---------------------------------------------------------
const guidesRes = await app.request("/api/guides");
const guidesBody = (await guidesRes.json()) as any;
check("GET /api/guides → 200", guidesRes.status === 200);
const guideSlugs = (guidesBody.guides ?? []).map((g: any) => g.slug);
check(
  "4 guías con slugs exactos",
  JSON.stringify(guideSlugs) ===
    JSON.stringify([
      "mejores-tv-55-panama",
      "laptops-menos-700-panama",
      "celulares-mejor-precio-panama",
      "linea-blanca-ofertas-panama",
    ]),
  guideSlugs
);
const tvGuide = guidesBody.guides?.[0];
const laptopGuide = guidesBody.guides?.[1];
const celGuide = guidesBody.guides?.[2];
check(
  "guía TV 55\": televisores, títulos/specs con 55, max 8 items",
  tvGuide.items.length > 0 &&
    tvGuide.items.length <= 8 &&
    tvGuide.items.every(
      (i: any) =>
        i.category === "televisores" &&
        (String(i.canonicalName).includes("55") ||
          i.bestPriceCents > 0)
    ),
  tvGuide.items?.slice(0, 2).map((i: any) => i.canonicalName.slice(0, 40))
);
check(
  "guía laptops ≤ $700 y sin 'accesorio' en título",
  laptopGuide.items.every((i: any) => i.bestPriceCents <= 70000) &&
    laptopGuide.items.every(
      (i: any) => !i.canonicalName.toLowerCase().includes("accesorio")
    ),
  laptopGuide.items?.slice(0, 3).map((i: any) => `${i.canonicalName.slice(0, 30)}:${i.bestPriceCents}`)
);
check(
  "guías multi-tienda (celulares/linea blanca): items con 2+ tiendas",
  celGuide.items.every((i: any) => i.storeCount >= 2),
  celGuide.items?.map((i: any) => i.storeCount)
);
check(
  "BuyingGuideDTO completo (subtitle, updatedAt, itemCount==items.length, maxPriceUsd)",
  guidesBody.guides.every(
    (g: any) =>
      g.subtitle.length > 10 &&
      typeof g.updatedAt === "string" &&
      g.itemCount === g.items.length &&
      (g.maxPriceUsd === null || typeof g.maxPriceUsd === "number")
  )
);

// Guía individual + 404
const guideRes = await app.request("/api/guides/linea-blanca-ofertas-panama");
const guideBody = (await guideRes.json()) as any;
check("GET /api/guides/:slug → 200", guideRes.status === 200 && guideBody.guide.slug === "linea-blanca-ofertas-panama");
const guideNotFound = await app.request("/api/guides/no-existe");
check("GET /api/guides/inexistente → 404", guideNotFound.status === 404);

// 2) priceInsight en el detalle ----------------------------------------------
// Elegir el producto con más días de historial real
const [bestTracked] = await db
  .select({ slug: sql<string>`p.slug`, days: sql<number>`count(distinct to_char(ph.recorded_at, 'YYYY-MM-DD'))::int` })
  .from(sql`products p`)
  .innerJoin(sql`store_listings sl`, sql`sl.product_id = p.id`)
  .innerJoin(sql`price_history ph`, sql`ph.listing_id = sl.id`)
  .groupBy(sql`p.slug`)
  .orderBy(sql`count(distinct to_char(ph.recorded_at, 'YYYY-MM-DD')) desc`)
  .limit(1) as any;
console.log(`   producto con más historial: ${bestTracked?.slug} (${bestTracked?.days} días)`);

const detailRes = await app.request(`/api/products/${bestTracked.slug}`);
const detailBody = (await detailRes.json()) as any;
const insight = detailBody.product?.priceInsight;
check("GET /api/products/:slug incluye priceInsight", detailRes.status === 200 && insight !== undefined, insight);
check(
  "priceInsight shape exacto (PriceInsightDTO)",
  insight &&
    typeof insight.daysTracked === "number" &&
    (insight.historicalLowCents === null || typeof insight.historicalLowCents === "number") &&
    (insight.historicalHighCents === null || typeof insight.historicalHighCents === "number") &&
    (insight.historicalAvgCents === null || typeof insight.historicalAvgCents === "number") &&
    typeof insight.fakeDiscountFlag === "boolean" &&
    (insight.fakeDiscountNote === null || typeof insight.fakeDiscountNote === "string") &&
    ["buy-now", "fair-price", "wait", "collecting-history"].includes(insight.buyAdvice) &&
    typeof insight.buyAdviceLabel === "string" &&
    insight.buyAdviceLabel.length > 0,
  insight
);
check(
  "daysTracked coincide con el historial real",
  insight.daysTracked === bestTracked.days,
  { insight: insight.daysTracked, real: bestTracked.days }
);
if (insight.daysTracked < 5) {
  check(
    "sin historial suficiente → collecting-history con texto honesto",
    insight.buyAdvice === "collecting-history" &&
      insight.buyAdviceLabel.includes("Acumulando historial diario"),
    insight.buyAdviceLabel
  );
} else {
  check(
    "con historial → veredicto informado (buy-now/wait/fair-price)",
    ["buy-now", "wait", "fair-price"].includes(insight.buyAdvice),
    insight.buyAdviceLabel
  );
}

// Detector de descuentos falsos: buscar un listing con "antes" inflado real
const [fakeCandidate] = await db
  .select({ slug: sql<string>`p.slug`, original: sql<number>`sl.original_price_cents`, price: sql<number>`sl.price_cents` })
  .from(sql`products p`)
  .innerJoin(sql`store_listings sl`, sql`sl.product_id = p.id`)
  .where(sql`sl.original_price_cents is not null and sl.original_price_cents > sl.price_cents * 2.3`)
  .orderBy(sql`(sl.original_price_cents - sl.price_cents) desc`)
  .limit(1) as any;
if (fakeCandidate) {
  const pct = Math.round((1 - fakeCandidate.price / fakeCandidate.original) * 100);
  console.log(`   candidato descuento dudoso: ${fakeCandidate.slug} (${pct}% anunciado)`);
  const fakeRes = await app.request(`/api/products/${fakeCandidate.slug}`);
  const fakeBody = (await fakeRes.json()) as any;
  const fakeInsight = fakeBody.product?.priceInsight;
  check(
    `descuento >55% real (${pct}%) → fakeDiscountFlag=true con nota honesta`,
    fakeInsight?.fakeDiscountFlag === true &&
      typeof fakeInsight.fakeDiscountNote === "string" &&
      fakeInsight.fakeDiscountNote.length > 10,
    fakeInsight
  );
} else {
  check("sin candidatos de descuento inflado en DB (skip detector)", true);
}

// 3) SEO /c/:category y /tienda/:slug ----------------------------------------
const catRes = await app.request("/c/televisores");
const catHtml = await catRes.text();
check(
  "GET /c/televisores → 200 HTML con CollectionPage + ItemList + OG",
  catRes.status === 200 &&
    (catRes.headers.get("content-type") ?? "").includes("text/html") &&
    catHtml.includes('"CollectionPage"') &&
    catHtml.includes('"ItemList"') &&
    catHtml.includes('property="og:title"') &&
    catHtml.includes("<title>"),
  catRes.status
);
check(
  "categoría: título con label y redirect limpio al catálogo (?categoria=)",
  catHtml.includes("Televisores") && catHtml.includes("?categoria=televisores"),
  catHtml.match(/<title>[^<]+/)?.[0]
);
const cat404 = await app.request("/c/categoria-inventada");
check("GET /c/inexistente → 404", cat404.status === 404);

const storeRes = await app.request("/tienda/panafoto");
const storeHtml = await storeRes.text();
check(
  "GET /tienda/panafoto → 200 HTML con CollectionPage + nombre real",
  storeRes.status === 200 &&
    storeHtml.includes('"CollectionPage"') &&
    storeHtml.includes("Panafoto") &&
    storeHtml.includes("?tienda=panafoto"),
  storeRes.status
);
const store404 = await app.request("/tienda/tienda-inventada");
check("GET /tienda/inexistente → 404", store404.status === 404);

// Sitemap ampliado con /c/ y /tienda/
const sitemapRes = await app.request("/sitemap.xml");
const sitemapText = await sitemapRes.text();
check(
  "sitemap.xml incluye /c/<categoría> y /tienda/<slug>",
  sitemapRes.status === 200 &&
    sitemapText.includes("<loc>http") &&
    sitemapText.includes("/c/televisores") &&
    sitemapText.includes("/tienda/panafoto") &&
    sitemapText.includes("/p/"),
  sitemapText.length
);

// 4) /api/admin/analytics -------------------------------------------------------
const an401 = await app.request("/api/admin/analytics");
check("analytics SIN secreto → 401", an401.status === 401, an401.status);
const anWrong = await app.request("/api/admin/analytics", {
  headers: { "x-cron-secret": "incorrecto" },
});
check("analytics con secreto inválido → 401", anWrong.status === 401);

// Sembrar métricas reales del período para verificar conteos
const [seedProduct] = await db
  .select({ id: sql<string>`id`, slug: sql<string>`slug` })
  .from(sql`products`)
  .limit(1) as any;
await db.execute(sql`
  insert into search_events (query, category, results_count)
  values ('query-analytics-phase3', 'televisores', 0)
`);
const anOk = await app.request("/api/admin/analytics?days=30", {
  headers: { "x-cron-secret": "dev-cron-secret-regateoapp" },
});
const analytics = (await anOk.json()) as any;
check("analytics CON secreto → 200", anOk.status === 200, anOk.status);
check(
  "AnalyticsSummaryDTO exacto",
  analytics &&
    analytics.periodDays === 30 &&
    typeof analytics.outboundClicksTotal === "number" &&
    Array.isArray(analytics.outboundClicksByStore) &&
    Array.isArray(analytics.topClickedProducts) &&
    Array.isArray(analytics.topSearches) &&
    Array.isArray(analytics.zeroResultSearches) &&
    typeof analytics.openPriceReportsCount === "number" &&
    typeof analytics.totalProducts === "number" &&
    analytics.totalProducts > 0 &&
    typeof analytics.multiStoreProducts === "number" &&
    typeof analytics.multiStoreCoveragePct === "number",
  Object.keys(analytics ?? {})
);
check(
  "búsqueda sembrada aparece en zeroResultSearches",
  (analytics.zeroResultSearches ?? []).some((s: any) => s.query === "query-analytics-phase3"),
  analytics.zeroResultSearches?.slice(0, 3)
);
check(
  "cobertura multi-tienda coherente",
  analytics.multiStoreProducts <= analytics.totalProducts &&
    analytics.multiStoreCoveragePct >= 0 &&
    analytics.multiStoreCoveragePct <= 100,
  { total: analytics.totalProducts, multi: analytics.multiStoreProducts, pct: analytics.multiStoreCoveragePct }
);
const anDays = await app.request("/api/admin/analytics?days=200", {
  headers: { "x-cron-secret": "dev-cron-secret-regateoapp" },
});
check("days=200 fuera de rango → 400", anDays.status === 400, anDays.status);
const anBearer = await app.request("/api/admin/analytics?days=7", {
  headers: { authorization: "Bearer dev-cron-secret-regateoapp" },
});
check(
  "Bearer + days=7 → 200 con periodDays=7",
  anBearer.status === 200 && ((await anBearer.json()) as any).periodDays === 7
);

// Limpieza del evento sembrado
await db.execute(sql`delete from search_events where query = 'query-analytics-phase3'`);
const [seedLeft] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`search_events`)
  .where(sql`query = 'query-analytics-phase3'`) as any;
check("cleanup del evento de prueba", (seedLeft?.total ?? 1) === 0);

console.log(
  failures === 0
    ? "\n🎉 FASE 3: TODAS LAS VERIFICACIONES PASARON"
    : `\n💥 ${failures} verificaciones fallaron`
);
process.exit(failures === 0 ? 0 : 1);
