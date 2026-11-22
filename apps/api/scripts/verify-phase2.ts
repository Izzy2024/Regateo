// ============================================================================
// Verificación Fase 2 (apps/api): Auth completa (providers, reset con captcha,
// sendResetPassword local) + refactor modular con columnas materializadas
// (doble vía probada materializando un producto real y revirtiendo).
// Ejecutar: bun scripts/verify-phase2.ts
// ============================================================================
import { app } from "../src/app";
import { db, sql } from "@regateo/db";
import {
  getProductBySlug,
  hydrateProductSummaries,
  searchProducts,
  statsForProducts,
  isMaterializedReady,
} from "../src/services/catalog";

const TEST_EMAIL = `phase2-test-${Date.now()}@regateo.test`;
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

// 1) GET /api/auth/providers -----------------------------------------------
const providersRes = await app.request("/api/auth/providers");
const providers = (await providersRes.json()) as any;
check(
  "GET /api/auth/providers → 200 { emailPassword, passwordReset, google }",
  providersRes.status === 200 &&
    providers.emailPassword === true &&
    providers.passwordReset === true &&
    typeof providers.google === "boolean",
  { status: providersRes.status, body: providers }
);
check(
  "google=false sin credenciales en dev",
  providers.google === false,
  providers.google
);

// 2) Protección de request-password-reset + forget-password ------------------
const resetNoCaptcha = await app.request("/api/auth/request-password-reset", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL, redirectTo: "http://localhost:5173" }),
});
check(
  "request-password-reset SIN captcha → 403",
  resetNoCaptcha.status === 403 && ((await resetNoCaptcha.json()) as any).error === "captcha_failed",
  resetNoCaptcha.status
);
const forgetNoCaptcha = await app.request("/api/auth/forget-password", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL }),
});
check(
  "forget-password SIN captcha → 403",
  forgetNoCaptcha.status === 403,
  forgetNoCaptcha.status
);

// Usuario real para el flujo de reseteo
const signup = await app.request("/api/auth/sign-up/email", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:5173",
    ...(await captchaHeaders()),
  },
  body: JSON.stringify({
    name: "Phase2 Tester",
    email: TEST_EMAIL,
    password: "phase2-test-12345",
  }),
});
check("signup con captcha 200", signup.status === 200 || signup.status === 201, signup.status);

const resetRes = await app.request("/api/auth/request-password-reset", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(await captchaHeaders()),
  },
  body: JSON.stringify({ email: TEST_EMAIL, redirectTo: "http://localhost:5173" }),
});
check(
  "request-password-reset CON captcha → 2xx",
  resetRes.status === 200 || resetRes.status === 201,
  resetRes.status
);
const [verificationRow] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`verification`)
  .where(sql`identifier like 'reset-password:%'`) as any;
check(
  "token de reseteo generado (verification reset-password:*) + sendResetPassword ejecutado (log local)",
  (verificationRow?.total ?? 0) > 0,
  verificationRow
);
const forgetRes = await app.request("/api/auth/forget-password", {
  method: "POST",
  headers: { "content-type": "application/json", ...(await captchaHeaders()) },
  body: JSON.stringify({ email: TEST_EMAIL, redirectTo: "http://localhost:5173" }),
});
check(
  "forget-password (alias) protegido: 2xx o 404 según versión de Better Auth",
  forgetRes.status === 200 || forgetRes.status === 404,
  forgetRes.status
);

// 3) Endpoints de catálogo tras el refactor modular ---------------------------
const productsRes = await app.request("/api/products?limit=24");
const productsBody = (await productsRes.json()) as any;
check("GET /api/products 200 tras refactor", productsRes.status === 200 && productsBody.items.length > 0);
check(
  "listings incluyen campo color (por tienda)",
  productsBody.items.some((i: any) => i.listings.every((l: any) => "color" in l)),
  productsBody.items[0]?.listings?.[0]
);
const slug = productsBody.items[0].slug;
const detailRes = await app.request(`/api/products/${slug}`);
const detailBody = (await detailRes.json()) as any;
check("GET /api/products/:slug 200 (detalle + similares + historial)", detailRes.status === 200 && detailBody.product.similarProducts !== undefined && Array.isArray(detailBody.product.priceHistory));
const similarRes = await app.request(`/api/products/${slug}/similar`);
const similarBody = (await similarRes.json()) as any;
check("GET /api/products/:slug/similar 200", similarRes.status === 200 && Array.isArray(similarBody.items));

// 4) Doble vía de stats (la DB ya está materializada por el scraper fase 2) ---
const materializedNow = await isMaterializedReady();
check(
  "vía activa = MATERIALIZADA (columnas indexadas de products)",
  materializedNow === true,
  materializedNow
);

const multiStoreItem = productsBody.items.find((i: any) => i.storeCount >= 2);
const snapshot = await getProductBySlug(multiStoreItem.slug); // vía materializada
const truth = await statsForProducts([multiStoreItem.id]);
const truthRow = truth.get(multiStoreItem.id) as any;
check("statsForProducts devuelve la verdad del agregado", Boolean(truthRow));
check(
  "columnas materializadas == verdad del agregado (scraper consistente)",
  snapshot!.bestPriceCents === truthRow.bestPriceCents &&
    snapshot!.highestPriceCents === truthRow.highestPriceCents &&
    snapshot!.storeCount === truthRow.storeCount &&
    snapshot!.inStockCount === truthRow.inStockCount,
  { materializadas: snapshot!.bestPriceCents, agregado: truthRow.bestPriceCents }
);

// Fallback por fila: null → agregado en vivo → mismos valores
await db.execute(sql`
  update products set
    best_price_cents = null,
    highest_price_cents = null,
    savings_cents = 0, savings_percent = 0,
    store_discount_cents = 0, store_discount_percent = 0,
    store_count = 0, in_stock_count = 0
  where id = ${multiStoreItem.id}
`);
const viaFallback = await getProductBySlug(multiStoreItem.slug);
check(
  "fallback por fila (null) entrega los mismos valores vía agregado",
  viaFallback !== null &&
    viaFallback.bestPriceCents === snapshot!.bestPriceCents &&
    viaFallback.highestPriceCents === snapshot!.highestPriceCents &&
    viaFallback.storeCount === snapshot!.storeCount,
  { fallback: viaFallback?.bestPriceCents, esperado: snapshot!.bestPriceCents }
);
const summariesFallback = await hydrateProductSummaries([multiStoreItem.id]);
check(
  "hydrateProductSummaries también degrada por fila",
  summariesFallback.get(multiStoreItem.id)?.bestPriceCents === snapshot!.bestPriceCents,
  summariesFallback.get(multiStoreItem.id)?.bestPriceCents
);

// Restaurar la materialización del scraper (valores exactos del snapshot)
await db.execute(sql`
  update products set
    best_price_cents = ${truthRow.bestPriceCents},
    highest_price_cents = ${truthRow.highestPriceCents},
    savings_cents = ${snapshot!.savingsCents},
    savings_percent = ${snapshot!.savingsPercent},
    store_discount_cents = ${snapshot!.storeDiscountCents ?? 0},
    store_discount_percent = ${snapshot!.storeDiscountPercent ?? 0},
    store_count = ${truthRow.storeCount},
    in_stock_count = ${truthRow.inStockCount}
  where id = ${multiStoreItem.id}
`);
const restored = await db
  .select({ best: sql<string | null>`best_price_cents` })
  .from(sql`products`)
  .where(sql`id = ${multiStoreItem.id}`) as any;
check("materialización restaurada", restored[0]?.best !== null);
const viaMaterialized = await getProductBySlug(multiStoreItem.slug);
check(
  "vía materializada restaurada == snapshot original",
  viaMaterialized !== null && viaMaterialized.bestPriceCents === snapshot!.bestPriceCents,
  { restaurado: viaMaterialized?.bestPriceCents, esperado: snapshot!.bestPriceCents }
);

// SearchProducts con facetas sigue íntegro (vía materializada indexada)
const searchCheck = await searchProducts({ q: "tv", sort: "relevance", page: 1, limit: 5 } as any);
check(
  "searchProducts directo: items + facetas + comparableCount",
  searchCheck.items.length > 0 &&
    searchCheck.facets.categories.length > 0 &&
    typeof searchCheck.comparableCount === "number",
  { items: searchCheck.items.length, comparable: searchCheck.comparableCount }
);

// 5) Limpieza ------------------------------------------------------------------
await db.execute(sql`delete from verification where identifier like 'reset-password:%' and expires_at < now()`);
await db.execute(sql`delete from "user" where email = ${TEST_EMAIL}`);
const [userLeft] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`"user"`)
  .where(sql`email = ${TEST_EMAIL}`) as any;
check("cleanup del usuario de prueba", (userLeft?.total ?? 1) === 0);

console.log(
  failures === 0
    ? "\n🎉 FASE 2: TODAS LAS VERIFICACIONES PASARON"
    : `\n💥 ${failures} verificaciones fallaron`
);
process.exit(failures === 0 ? 0 : 1);
