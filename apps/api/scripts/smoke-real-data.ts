// ============================================================================
// Smoke test de SOLO LECTURA contra datos reales ya raspados en regateoapp_dev.
// No siembra ni borra nada. Ejecutar: bun scripts/smoke-real-data.ts
// ============================================================================
import { app } from "../src/app";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}

const health = await app.request("/api/health");
const healthBody = (await health.json()) as any;
check("health 200 + db connected", health.status === 200 && healthBody.db === "connected");

const listRes = await app.request("/api/products?limit=24");
const listBody = (await listRes.json()) as any;
check("products 200", listRes.status === 200);
check("items reales presentes", listBody.items.length > 0, listBody.items.length);
check(
  "item con mejor precio + tienda ganadora",
  listBody.items.every(
    (i: any) => i.bestPriceCents > 0 && i.bestStore?.slug && i.bestStore?.name
  ),
  listBody.items[0]
);
check(
  "listings con URL real verificable",
  listBody.items[0]?.listings?.every((l: any) => l.url.startsWith("http")),
  listBody.items[0]?.listings?.[0]?.url
);
check("facets con categorías", listBody.facets.categories.length > 0, listBody.facets.categories.slice(0, 3));
check("facets con marcas", listBody.facets.brands.length > 0);
check("facets con tiendas", listBody.facets.stores.length > 0, listBody.facets.stores);
check("pagination consistente", listBody.pagination.total >= listBody.items.length);
check("lastScrapedAt presente", typeof listBody.meta.lastScrapedAt === "string", listBody.meta.lastScrapedAt);

const qRes = await app.request("/api/products?q=tv%20samsung&limit=5");
const qBody = (await qRes.json()) as any;
check("búsqueda multi-token real (tv samsung) → resultados", qBody.items.length > 0, qBody.items.map((i: any) => i.canonicalName).slice(0, 3));

const dealsRes = await app.request("/api/products/deals?limit=10");
const dealsBody = (await dealsRes.json()) as any;
check("deals 200 con ofertas reales", dealsRes.status === 200 && dealsBody.items.length > 0);
const savingsList = dealsBody.items.map((i: any) => i.savingsCents);
check(
  "deals ordenadas por ahorro desc",
  savingsList.every((v: number, idx: number) => idx === 0 || savingsList[idx - 1] >= v),
  savingsList.slice(0, 5)
);
const deals60 = (await (await app.request("/api/products/deals?limit=60")).json()) as any;
const multiStoreDeals = deals60.items.filter((i: any) => i.storeCount >= 2);
check(
  "deals incluyen comparaciones multi-tienda reales",
  multiStoreDeals.length > 0,
  multiStoreDeals.slice(0, 2).map((i: any) => `${i.canonicalName} (${i.storeCount} tiendas)`)
);

const topSlug = listBody.items.find((i: any) => i.storeCount >= 2)?.slug ?? listBody.items[0].slug;
const detailRes = await app.request(`/api/products/${topSlug}`);
const detailBody = (await detailRes.json()) as any;
check(`detalle 200 (${topSlug})`, detailRes.status === 200);
check(
  "listings asc con isCheapest/delta",
  detailBody.product.listings[0].isCheapest === true &&
    detailBody.product.listings.at(-1).deltaFromCheapestCents >= 0
);
check(
  "priceHistory para Recharts",
  Array.isArray(detailBody.product.priceHistory) && detailBody.product.priceHistory.length > 0,
  detailBody.product.priceHistory?.length
);

const storesRes = await app.request("/api/stores");
const storesBody = (await storesRes.json()) as any;
check("stores 200", storesRes.status === 200);
check(
  "tiendas reales con conteos",
  storesBody.stores.length >= 4 &&
    storesBody.stores.every((s: any) => typeof s.listingCount === "number" && s.listingCount >= 0),
  storesBody.stores.map((s: any) => `${s.slug}:${s.listingCount}`)
);
check("runs recientes", storesBody.recentRuns.length > 0);

// Asistente IA en streaming con datos reales
const aiRes = await app.request("/api/ai/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    messages: [{ role: "user", content: "¿Cuánto cuesta un televisor Samsung? Dame la comparación entre tiendas" }],
  }),
});
const sseText = await aiRes.text();
const events = sseText
  .split("\n\n")
  .filter((line) => line.startsWith("data: "))
  .map((line) => JSON.parse(line.slice(6)));
const types = events.map((e: any) => e.type);
check("AI SSE tool-call→tool-result→text-delta→done", types.includes("tool-call") && types.includes("tool-result") && types.includes("text-delta") && types.at(-1) === "done", types);
const toolResult = JSON.stringify(events.find((e: any) => e.type === "tool-result") ?? {});
check("AI tool-result con tiendas reales", /multimax|panafoto|rodelag|titan|photura|doitcenter|yoytec|ptytec/i.test(toolResult), toolResult.slice(0, 200));
const deltas = events.filter((e: any) => e.type === "text-delta").map((e: any) => e.delta).join("");
check("AI respuesta con precio USD real", /(USD\s?\d|\$\d)/.test(deltas), deltas.slice(0, 300));

console.log(
  failures === 0
    ? "\n🎉 SMOKE TEST CONTRA DATOS REALES: TODO OK"
    : `\n💥 ${failures} verificaciones fallaron`
);
process.exit(failures === 0 ? 0 : 1);
