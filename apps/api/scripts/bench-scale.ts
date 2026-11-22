// ============================================================================
// Benchmark de escala para apps/api: siembra ~20,000 productos sintéticos en
// regateoapp_dev (con 3,280 en una sola categoría), mide latencias FRÍAS
// (sin caché) de /similar y /products, verifica búsqueda por SKU/título de
// tienda y maxPerStore=20000, y SIEMPRE limpia (finally).
// Ejecutar: bun scripts/bench-scale.ts
// ============================================================================
import { app } from "../src/app";
import { triggerScrapeSchema } from "@regateo/shared";
import {
  db,
  products,
  storeListings,
  stores,
  eq,
  inArray,
  sql,
} from "@regateo/db";

const BENCH_KEY = "bench::";
const CATEGORY_STRESS = "accesorios"; // 3,000 bench + 280 reales = 3,280
const BENCH_BRANDS = ["Samsung", "LG", "Sony", "Xiaomi", "HP", null];
const BENCH_KINDS = [
  "Audífono Bluetooth Bench",
  "Cable HDMI 2.1 Bench",
  "Mouse Inalámbrico Bench",
  "Teclado Mecánico Bench",
  "Cargador USB-C Bench",
  "Hub USB Bench",
  "Estuche Bench",
  "Funda Protectora Bench",
];

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}
function ms(start: number): string {
  return `${(performance.now() - start).toFixed(1)}ms`;
}

async function seed(): Promise<{ targetSlug: string; total: number }> {
  const [benchStore1, benchStore2] = await db
    .insert(stores)
    .values([
      { slug: "bench-store-1", name: "Bench Store 1", baseUrl: "https://bench1.test", platform: "custom", color: "#111111", accentBg: "#F5F5F5" },
      { slug: "bench-store-2", name: "Bench Store 2", baseUrl: "https://bench2.test", platform: "custom", color: "#222222", accentBg: "#FAFAFA" },
    ])
    .returning();

  // 20,000 productos: 3,000 en la categoría estresada + 17,000 repartidos
  const categories = [
    "accesorios", "televisores", "linea-blanca", "audio", "celulares",
    "computadoras", "perifericos", "electrodomesticos",
  ];
  const productValues: Array<typeof products.$inferInsert> = [];
  for (let i = 0; i < 20_000; i += 1) {
    const inStress = i < 3_000;
    const category = inStress
      ? CATEGORY_STRESS
      : categories[1 + (i % (categories.length - 1))];
    productValues.push({
      slug: `bench-p-${i}`,
      matchKey: `${BENCH_KEY}p-${i}`,
      canonicalName: `${BENCH_KINDS[i % BENCH_KINDS.length]} ${i}`,
      brand: BENCH_BRANDS[i % BENCH_BRANDS.length],
      modelNumber: `BENCH${100000 + i}`,
      category,
      specs: inStress && i % 7 === 0 ? { screenSizeInches: 32 } : null,
    });
  }

  for (let chunk = 0; chunk < productValues.length; chunk += 500) {
    await db.insert(products).values(productValues.slice(chunk, chunk + 500));
  }

  const idMap = new Map<string, string>();
  const benchRows = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(sql`${products.matchKey} like ${`${BENCH_KEY}%`}`);
  for (const row of benchRows) idMap.set(row.slug, row.id);

  const listingValues: Array<typeof storeListings.$inferInsert> = [];
  for (let i = 0; i < 20_000; i += 1) {
    const productId = idMap.get(`bench-p-${i}`);
    if (!productId) continue;
    const priceCents = 1500 + (i % 240) * 100;
    const specialSku = i < 5; // SKUs de tienda para probar búsqueda por external_id
    listingValues.push({
      productId,
      storeId: benchStore1.id,
      externalId: specialSku ? `15514${i}` : `b-${1000000 + i}`,
      titleAtStore: specialSku
        ? `Producto Tienda SKU REGATEOXYZ ${i}`
        : `${BENCH_KINDS[i % BENCH_KINDS.length]} ${i}`,
      priceCents,
      inStock: true,
      url: `https://bench1.test/p/${i}`,
      lastCheckedAt: new Date(),
    });
    if (i % 3 === 0) {
      // Cada 5º producto es MÁS BARATO en bench-store-2 -> bestStore diversificado
      const cheaperAtStore2 = i % 5 === 0;
      listingValues.push({
        productId,
        storeId: benchStore2.id,
        externalId: `b2-${1000000 + i}`,
        titleAtStore: `${BENCH_KINDS[i % BENCH_KINDS.length]} ${i} Edición 2`,
        priceCents: cheaperAtStore2 ? Math.round(priceCents * 0.8) : Math.round(priceCents * 1.25),
        inStock: true,
        url: `https://bench2.test/p/${i}`,
        lastCheckedAt: new Date(),
      });
    }
  }

  for (let chunk = 0; chunk < listingValues.length; chunk += 1000) {
    await db.insert(storeListings).values(listingValues.slice(chunk, chunk + 1000));
  }

  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(products);
  const [stressRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.category, CATEGORY_STRESS));

  return {
    targetSlug: "bench-p-1",
    total: countRow.total,
    stressCount: stressRow.total,
  } as unknown as { targetSlug: string; total: number; stressCount: number };
}

async function cleanup(): Promise<void> {
  const benchIds = await db
    .select({ id: products.id })
    .from(products)
    .where(sql`${products.matchKey} like ${`${BENCH_KEY}%`}`);
  const ids = benchIds.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(products).where(inArray(products.id, ids));
  }
  await db.delete(stores).where(inArray(stores.slug, ["bench-store-1", "bench-store-2"]));
}

async function main() {
  const seedStart = performance.now();
  console.log("🌱 Sembrando 20,000 productos sintéticos (+listings)…");
  const info = await seed();
  console.log(
    `   listo en ${ms(seedStart)} — total productos en DB: ${info.total}, en "${CATEGORY_STRESS}": ${info.stressCount}`
  );

  try {
    // ------------------------------------------------------------------
    console.log(
      `\n— 1) /api/products/:slug/similar — CATEGORÍA CON ${(info as any).stressCount} PRODUCTOS (objetivo: <120ms frío)`
    );
    const coldTimes: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const slug = `bench-p-${i}`;
      const start = performance.now();
      const res = await app.request(`/api/products/${slug}/similar?limit=8`);
      const elapsed = performance.now() - start;
      coldTimes.push(elapsed);
      const body = (await res.json()) as any;
      if (res.status !== 200 || body.items?.length === 0) {
        check(`similar bench-p-${i} responde con items`, false, { status: res.status, n: body.items?.length });
      }
    }
    const worst = Math.max(...coldTimes);
    const avg = coldTimes.reduce((a, b) => a + b, 0) / coldTimes.length;
    check(
      `similar frío: peor=${worst.toFixed(1)}ms promedio=${avg.toFixed(1)}ms < 120ms`,
      worst < 120,
      coldTimes.map((t) => t.toFixed(0))
    );
    const warmStart = performance.now();
    await app.request(`/api/products/bench-p-1/similar?limit=8`);
    const warm = performance.now() - warmStart;
    check(`similar cacheado (2ª llamada): ${warm.toFixed(1)}ms < 5ms`, warm < 5);

    const sample = (await (
      (await app.request("/api/products/bench-p-1/similar?limit=8")).json()
    ) as any);
    check(
      "items con razones y score reales bajo carga",
      sample.items.every(
        (i: any) => i.matchReasons.length > 0 && i.similarityScore > 0 && typeof i.priceDiffCents === "number"
      ),
      sample.items[0]
    );
    const storeSet = new Set(sample.items.map((i: any) => i.bestStore.slug));
    check(`diversidad bajo carga (${[...storeSet].join(",")})`, storeSet.size > 1 || sample.items.length === 0);

    // ------------------------------------------------------------------
    console.log("\n— 2) Búsqueda por external_id/SKU y title_at_store");
    const skuStart = performance.now();
    const skuRes = await app.request("/api/products?q=155144&limit=5");
    const skuElapsed = performance.now() - skuStart;
    const skuBody = (await skuRes.json()) as any;
    check(
      `q=155144 (SKU de tienda) encuentra el producto [${skuElapsed.toFixed(1)}ms]`,
      skuRes.status === 200 &&
        skuBody.items.length === 1 &&
        skuBody.items[0].slug === "bench-p-4",
      skuBody.items.map((i: any) => i.slug)
    );

    const titleStart = performance.now();
    const titleRes = await app.request("/api/products?q=REGATEOXYZ&limit=5");
    const titleBody = (await titleRes.json()) as any;
    check(
      `q=REGATEOXYZ (title_at_store) encuentra 5 productos [${(performance.now() - titleStart).toFixed(1)}ms]`,
      titleRes.status === 200 && titleBody.items.length === 5,
      titleBody.items.map((i: any) => i.slug)
    );

    const canonicalStart = performance.now();
    const canonicalRes = await app.request("/api/products?q=bluetooth%20bench&limit=5");
    const canonicalElapsed = performance.now() - canonicalStart;
    const canonicalBody = (await canonicalRes.json()) as any;
    check(
      `q canónico sigue funcionando (bluetooth bench) [${canonicalElapsed.toFixed(1)}ms]`,
      canonicalRes.status === 200 && canonicalBody.items.length > 0,
      canonicalBody.items.length
    );

    const realSkuStart = performance.now();
    const realSkuRes = await app.request("/api/products?q=tv&limit=5");
    check(
      `q tv sin regresión [${(performance.now() - realSkuStart).toFixed(1)}ms]`,
      realSkuRes.status === 200
    );

    // ------------------------------------------------------------------
    console.log("\n— 3) Latencia general /api/products con ~21,400 productos");
    const listTimes: number[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const start = performance.now();
      const res = await app.request(`/api/products?limit=24&page=${page}&category=${CATEGORY_STRESS}`);
      listTimes.push(performance.now() - start);
      const body = (await res.json()) as any;
      if (res.status !== 200 || body.items.length === 0) {
        check(`listado página ${page}`, false, res.status);
      }
    }
    const listWorst = Math.max(...listTimes);
    check(
      `listado frío (24 items + facets): peor=${listWorst.toFixed(1)}ms (caché 60s en prod)`,
      listWorst < 500,
      listTimes.map((t) => t.toFixed(0))
    );

    // ------------------------------------------------------------------
    console.log("\n— 4) /api/cron/scrape: maxPerStore hasta 20000");
    check(
      "triggerScrapeSchema acepta maxPerStore=20000",
      triggerScrapeSchema.safeParse({ maxPerStore: 20000 }).success
    );
    check(
      "triggerScrapeSchema rechaza maxPerStore=20001",
      !triggerScrapeSchema.safeParse({ maxPerStore: 20001 }).success
    );
    check(
      "default maxPerStore = 5000",
      triggerScrapeSchema.parse({}).maxPerStore === 5000
    );
    const invalidCron = await app.request("/api/cron/scrape", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "dev-cron-secret-regateoapp" },
      body: JSON.stringify({ maxPerStore: 99999 }),
    });
    check(`cron rechaza maxPerStore=99999 (400)`, invalidCron.status === 400, invalidCron.status);
    const body400 = (await invalidCron.json()) as any;
    check("cron 400 con detalle del path", body400.details?.[0]?.path === "maxPerStore");

    // maxPerStore=20000 aceptado: usa una tienda inexistente para no disparar scrape real
    const validCron = await app.request("/api/cron/scrape", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": "dev-cron-secret-regateoapp",
        "x-manual-trigger": "true",
      },
      body: JSON.stringify({ stores: ["inexistente-bench"], maxPerStore: 20000 }),
    });
    check(
      "cron acepta maxPerStore=20000 (202, sin tiendas que scrapear)",
      validCron.status === 202,
      validCron.status
    );
  } finally {
    console.log("\n🧹 Limpiando 20,000 productos sintéticos…");
    const cleanStart = performance.now();
    await cleanup();
    const remaining = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .where(sql`${products.matchKey} like ${`${BENCH_KEY}%`}`);
    check(`cleanup completo [${ms(cleanStart)}]`, remaining[0].total === 0);
    const [finalCount] = await db.select({ total: sql<number>`count(*)::int` }).from(products);
    console.log(`   productos reales en DB: ${finalCount.total}`);
  }

  console.log(
    failures === 0
      ? "\n🎉 BENCHMARK DE ESCALA: TODAS LAS VERIFICACIONES PASARON"
      : `\n💥 ${failures} verificaciones fallaron`
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
