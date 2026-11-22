// ============================================================================
// Verificación end-to-end de la API contra PostgreSQL local (regateoapp_dev).
// ATENCION: usar en DB vacia/fresca (asume conteos absolutos).
// Siembra un fixture temporal aislado (slugs verify-*, matchKey "verify::"), prueba todos los
// endpoints con app.request y limpia al final. NO es parte de src/ (solo dev).
// Ejecutar: bun scripts/verify-endpoints.ts
// ============================================================================
import { app } from "../src/app";
import {
  db,
  products,
  storeListings,
  stores,
  priceHistory,
  scrapeRuns,
  priceAlerts,
  eq,
  like,
  inArray,
  and,
  sql,
} from "@regateo/db";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}

async function seedFixture() {
  const [multimax, panafoto, rodelag] = await db
    .insert(stores)
    .values([
      { slug: "verify-store-a", name: "Verify A", baseUrl: "https://www.multimax.net", platform: "shopify", color: "#E11D48", accentBg: "#FFF1F2" },
      { slug: "verify-store-b", name: "Verify B", baseUrl: "https://www.panafoto.com", platform: "magento", color: "#1D4ED8", accentBg: "#EFF6FF" },
      { slug: "verify-store-c", name: "Verify C", baseUrl: "https://rodelag.com", platform: "shopify", color: "#EA580C", accentBg: "#FFF7ED" },
    ])
    .returning();

  const [tv, washer, mouse] = await db
    .insert(products)
    .values([
      {
        slug: "verify-tv-samsung-55-qled",
        matchKey: "verify::tv55",
        canonicalName: 'Samsung Smart TV 55" QLED QN55Q60D',
        brand: "Samsung",
        modelNumber: "QN55Q60D",
        category: "televisores",
        specs: { screen: '55"', panel: "QLED" },
      },
      {
        slug: "verify-lavadora-samsung-20",
        matchKey: "verify::washer20",
        canonicalName: "Lavadora Samsung 20kg WF20B9600",
        brand: "Samsung",
        modelNumber: "WF20B9600",
        category: "linea-blanca",
      },
      {
        slug: "verify-mouse-logitech-mx3s",
        matchKey: "verify::mx3s",
        canonicalName: "Mouse Logitech MX Master 3S",
        brand: "Logitech",
        modelNumber: "MX-MASTER-3S",
        category: "perifericos",
      },
    ])
    .returning();

  const listingRows = await db
    .insert(storeListings)
    .values([
      { productId: tv.id, storeId: multimax.id, externalId: "verify-tv-1", titleAtStore: 'Samsung Smart TV 55" QLED QN55Q60D', priceCents: 49900, inStock: true, url: "https://www.multimax.net/products/verify-tv-1", lastCheckedAt: new Date() },
      { productId: tv.id, storeId: panafoto.id, externalId: "verify-tv-2", titleAtStore: 'TV Samsung 55 QLED Q60D', priceCents: 55900, inStock: true, url: "https://www.panafoto.com/verify-tv-2", lastCheckedAt: new Date() },
      { productId: tv.id, storeId: rodelag.id, externalId: "verify-tv-3", titleAtStore: 'Samsung 55" QLED', priceCents: 58900, inStock: false, url: "https://rodelag.com/products/verify-tv-3", lastCheckedAt: new Date() },
      { productId: washer.id, storeId: multimax.id, externalId: "verify-w-1", titleAtStore: "Lavadora Samsung 20kg", priceCents: 89900, inStock: true, url: "https://www.multimax.net/products/verify-w-1", lastCheckedAt: new Date() },
      { productId: washer.id, storeId: rodelag.id, externalId: "verify-w-2", titleAtStore: "Lavadora Samsumg 20Kg Inverter", priceCents: 94900, inStock: true, url: "https://rodelag.com/products/verify-w-2", lastCheckedAt: new Date() },
      { productId: mouse.id, storeId: panafoto.id, externalId: "verify-m-1", titleAtStore: "Logitech MX Master 3S", priceCents: 8900, originalPriceCents: 10900, inStock: true, url: "https://www.panafoto.com/verify-m-1", lastCheckedAt: new Date() },
    ])
    .returning();

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  await db.insert(priceHistory).values(
    listingRows.flatMap((listing, index) => [
      { listingId: listing.id, priceCents: listing.priceCents + 2000, inStock: true, recordedAt: new Date(now - 3 * day) },
      { listingId: listing.id, priceCents: listing.priceCents, inStock: true, recordedAt: new Date(now - (index % 2) * day) },
    ])
  );

  await db.insert(scrapeRuns).values([
    { storeId: multimax.id, storeSlug: "verify-store-a", engine: "shopify-json", status: "completed", itemsFound: 2, itemsUpserted: 2, startedAt: new Date(now - day), finishedAt: new Date(now - day + 60000) },
    { storeId: panafoto.id, storeSlug: "verify-store-b", engine: "firecrawl", status: "completed", itemsFound: 2, itemsUpserted: 2, startedAt: new Date(now - day + 60000), finishedAt: new Date(now - day + 120000) },
  ]);

  return { tv, washer, mouse };
}

async function cleanupFixture() {
  const fixtureProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(sql`${products.matchKey} like 'verify::%'`);
  const ids = fixtureProducts.map((p) => p.id);
  if (ids.length > 0) {
    await db.delete(priceAlerts).where(inArray(priceAlerts.productId, ids));
    await db.delete(products).where(inArray(products.id, ids));
  }
  await db.delete(scrapeRuns)
  await db.delete(stores).where(
    sql`${stores.slug} like 'verify-%'`
  );
}

async function main() {
  console.log("🌱 Sembrando fixture de verificación…");
  const { tv } = await seedFixture();

  console.log("\n— GET /api/health");
  const health = await app.request("/api/health");
  const healthBody = (await health.json()) as any;
  check("status 200", health.status === 200);
  check("service correcto", healthBody.service === "regateoapp-api");
  check("db connected", healthBody.db === "connected", healthBody);
  check("cache memory/upstash", ["memory", "upstash"].includes(healthBody.cache));

  console.log("\n— GET /api/products (con filtros y facets)");
  const listRes = await app.request("/api/products?limit=10");
  const listBody = (await listRes.json()) as any;
  check("status 200", listRes.status === 200);
  check("3 productos", listBody.items.length === 3, listBody.items?.length);
  check("pagination.total=3", listBody.pagination.total === 3);
  check("facets categorias=3", listBody.facets.categories.length === 3);
  check("facets marcas=2", listBody.facets.brands.length === 2, listBody.facets.brands);
  check("facets tiendas=3", listBody.facets.stores.length === 3);
  check("meta.lastScrapedAt presente", typeof listBody.meta.lastScrapedAt === "string" || listBody.meta.lastScrapedAt === null);
  const tvItem = listBody.items.find((i: any) => i.slug === "verify-tv-samsung-55-qled");
  check("TV bestPrice=499.00", tvItem?.bestPriceCents === 49900, tvItem?.bestPriceCents);
  check("TV highest=589.00", tvItem?.highestPriceCents === 58900);
  check("TV savings=90.00 (9000c)", tvItem?.savingsCents === 9000, tvItem?.savingsCents);
  check("TV savingsPercent≈15.28", tvItem?.savingsPercent > 15 && tvItem?.savingsPercent < 16, tvItem?.savingsPercent);
  check("TV storeCount=3, inStock=2", tvItem?.storeCount === 3 && tvItem?.inStockCount === 2);
  check("TV bestStore=verify-store-a", tvItem?.bestStore?.slug === "verify-store-a");
  check("TV listings asc con isCheapest", tvItem?.listings?.[0]?.isCheapest === true && tvItem?.listings?.[2]?.deltaFromCheapestCents === 9000);

  const qRes = await app.request("/api/products?q=smart%20tv%2055&sort=price-asc");
  const qBody = (await qRes.json()) as any;
  check("q multi-token (smart tv 55) → 1", qBody.items.length === 1 && qBody.items[0].slug === "verify-tv-samsung-55-qled");

  const storeRes = await app.request("/api/products?store=verify-store-b&inStockOnly=true");
  const storeBody = (await storeRes.json()) as any;
  check("store=verify-store-b + inStockOnly → 2", storeBody.items.length === 2, storeBody.items?.map((i: any) => i.slug));

  const multiRes = await app.request("/api/products?multiStoreOnly=true");
  check("multiStoreOnly → 2", ((await multiRes.json()) as any).items.length === 2);

  const priceRes = await app.request("/api/products?minPrice=400&maxPrice=600");
  const priceBody = (await priceRes.json()) as any;
  check("minPrice/maxPrice USD→centavos", priceBody.items.length === 1 && priceBody.items[0].slug === "verify-tv-samsung-55-qled");

  console.log("\n— GET /api/products/deals");
  const dealsRes = await app.request("/api/products/deals?limit=5");
  const dealsBody = (await dealsRes.json()) as any;
  check("status 200", dealsRes.status === 200);
  check("deals ordenadas por ahorro (TV 9000 > Lav 5000 > Mouse 2000)", dealsBody.items.length === 3 && dealsBody.items.map((i: any) => i.savingsCents).join(",") === "9000,5000,2000", dealsBody.items?.map((i: any) => i.savingsCents));

  console.log("\n— GET /api/products/:slug");
  const detailRes = await app.request("/api/products/verify-tv-samsung-55-qled");
  const detailBody = (await detailRes.json()) as any;
  check("status 200", detailRes.status === 200);
  check("specs presentes", detailBody.product.specs?.panel === "QLED");
  check("priceHistory agrupada", Array.isArray(detailBody.product.priceHistory) && detailBody.product.priceHistory.length >= 5, detailBody.product.priceHistory?.length);
  const firstPoint = detailBody.product.priceHistory?.[0];
  check("priceHistory point shape", firstPoint?.date && firstPoint?.storeSlug && firstPoint?.priceCents && firstPoint?.storeColor);

  const notFoundRes = await app.request("/api/products/no-existe");
  check("404 en slug inexistente", notFoundRes.status === 404);

  console.log("\n— GET /api/stores");
  const storesRes = await app.request("/api/stores");
  const storesBody = (await storesRes.json()) as any;
  check("status 200", storesRes.status === 200);
  check("3 tiendas con listingCount", storesBody.stores.length === 3 && storesBody.stores.every((s: any) => typeof s.listingCount === "number"));
  check("recentRuns=2", storesBody.recentRuns.length === 2);

  console.log("\n— POST /api/alerts + GET /api/alerts?email=");
  const badAlertRes = await app.request("/api/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: tv.id, email: "no-email", targetPriceCents: 100 }),
  });
  check("400 con email inválido", badAlertRes.status === 400);

  const alertRes = await app.request("/api/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: tv.id, email: "regateo@test.pa", targetPriceCents: 45000 }),
  });
  const alertBody = (await alertRes.json()) as any;
  check("201 creado", alertRes.status === 201 && alertBody.alert.targetPriceCents === 45000);
  check("alert.product con best price actual", alertBody.alert.product.currentBestPriceCents === 49900);

  const alertsListRes = await app.request("/api/alerts?email=regateo@test.pa");
  const alertsListBody = (await alertsListRes.json()) as any;
  check("listado 1 alerta activa", alertsListBody.alerts.length === 1);
  const missingProductAlert = await app.request("/api/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: "00000000-0000-4000-8000-000000000000", email: "x@test.pa", targetPriceCents: 1000 }),
  });
  check("404 producto inexistente", missingProductAlert.status === 404);

  console.log("\n— POST /api/ai/chat (SSE determinista sin API key)");
  const aiRes = await app.request("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "¿cuánto cuesta el televisor Samsung 55?" }] }),
  });
  check("content-type text/event-stream", (aiRes.headers.get("content-type") ?? "").startsWith("text/event-stream"));
  const sseText = await aiRes.text();
  const events = sseText
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const types = events.map((e: any) => e.type);
  check("emite tool-call", types.includes("tool-call") && events.find((e: any) => e.type === "tool-call")?.toolName === "compareProductPrices", types);
  check("emite tool-result con datos reales", types.includes("tool-result") && JSON.stringify(events).includes("verify-store-a"));
  check("emite text-delta", types.includes("text-delta"));
  check("termina con done", types.at(-1) === "done", types);

  const badAiRes = await app.request("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  check("400 con messages vacíos", badAiRes.status === 400);

  console.log("\n— POST /api/cron/scrape (seguridad)");
  const unauthorized = await app.request("/api/cron/scrape", { method: "POST" });
  check("401 sin secreto", unauthorized.status === 401);
  const wrongSecret = await app.request("/api/cron/scrape", {
    method: "POST",
    headers: { "x-cron-secret": "incorrecto" },
  });
  check("401 con secreto inválido", wrongSecret.status === 401);

  const missingProductDb = await db.select().from(products).where(eq(products.id, tv.id)).limit(1);
  check("fixture sigue en DB", missingProductDb.length === 1);

  console.log("\n🧹 Limpiando fixture…");
  await cleanupFixture();
  const remaining = await db.select().from(products).where(sql`${products.matchKey} like 'verify::%'`);
  check("cleanup completo", remaining.length === 0);

  console.log(
    failures === 0
      ? "\n🎉 TODAS LAS VERIFICACIONES PASARON"
      : `\n💥 ${failures} verificaciones fallaron`
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
