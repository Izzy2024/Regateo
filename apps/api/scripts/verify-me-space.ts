// ============================================================================
// Verificación real de "Mi Espacio" (Sprint 4) contra PostgreSQL local:
// crea usuario real con Better Auth, prueba 401s, favoritos, sync, listas,
// ítems, alertas (PATCH/DELETE con propiedad por userId y email) y overview.
// Limpia todo al final. Ejecutar: bun scripts/verify-me-space.ts
// ============================================================================
import { app } from "../src/app";
import { db, sql } from "@regateo/db";

const TEST_EMAIL = `me-space-test-${Date.now()}@regateo.test`;
const TEST_PASSWORD = "regateo-test-12345";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}

// Sprint 5: signup/signin exigen CAPTCHA — resolvemos el desafío builtin.
async function captchaHeaders(): Promise<Record<string, string>> {
  const res = await app.request("/api/security/captcha");
  const body = (await res.json()) as any;
  const match = body.challenge.question.match(/(\d+) \+ (\d+)/);
  return {
    "x-captcha-token": body.challenge.token,
    "x-captcha-answer": String(Number(match[1]) + Number(match[2])),
  };
}

// 1) Signup real con Better Auth (+ CAPTCHA del Sprint 5) ---------------
const signup = await app.request("/api/auth/sign-up/email", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:5173",
    ...(await captchaHeaders()),
  },
  body: JSON.stringify({
    name: "Mi Espacio Tester",
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  }),
});
const signupBody = (await signup.json()) as any;
check("signup 200", signup.status === 200 && signupBody.user?.email === TEST_EMAIL, signup.status);

const signin = await app.request("/api/auth/sign-in/email", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:5173",
    ...(await captchaHeaders()),
  },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
});
const cookie = (signin.headers.getSetCookie?.() ?? [])
  .map((value: string) => value.split(";")[0])
  .join("; ");
check("signin 200 con cookie de sesión", signin.status === 200 && cookie.includes("session_token"));
const authHeaders = { "content-type": "application/json", cookie };

const [userRow] = await db
  .select({ id: sql<string>`id` })
  .from(sql`"user"`)
  .where(sql`email = ${TEST_EMAIL}`)
  .limit(1) as any;
const userId = userRow?.id ?? signupBody.user?.id;
console.log(`   usuario: ${TEST_EMAIL} (${userId})`);

// 2) 401 sin sesión en TODAS las rutas /api/me/* ---------------------------
const meRoutes: Array<[string, string, string]> = [
  ["GET", "/api/me/overview", ""],
  ["POST", "/api/me/favorites", JSON.stringify({ productId: "00000000-0000-4000-8000-000000000000" })],
  ["DELETE", "/api/me/favorites/00000000-0000-4000-8000-000000000000", ""],
  ["POST", "/api/me/favorites/sync", JSON.stringify({ productIds: [] })],
  ["POST", "/api/me/lists", JSON.stringify({ name: "test" })],
  ["DELETE", "/api/me/lists/00000000-0000-4000-8000-000000000000", ""],
  ["POST", "/api/me/lists/00000000-0000-4000-8000-000000000000/items", JSON.stringify({ productId: "00000000-0000-4000-8000-000000000000" })],
  ["DELETE", "/api/me/lists/00000000-0000-4000-8000-000000000000/items/00000000-0000-4000-8000-000000000000", ""],
  ["PATCH", "/api/me/alerts/00000000-0000-4000-8000-000000000000", JSON.stringify({ active: false })],
  ["DELETE", "/api/me/alerts/00000000-0000-4000-8000-000000000000", ""],
];
for (const [method, path, body] of meRoutes) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body || undefined,
  });
  const resBody = (await res.json()) as any;
  check(
    `401 sin sesión: ${method} ${path}`,
    res.status === 401 &&
      resBody.error === "unauthorized" &&
      resBody.message === "Inicia sesión para acceder a Mi Espacio.",
    { status: res.status, body: resBody }
  );
}

// 3) Productos reales para operar ------------------------------------------
const listRes = await app.request("/api/products?limit=5&multiStoreOnly=true");
const listBody = (await listRes.json()) as any;
const p1 = listBody.items[0];
const p2 = listBody.items[1];
const p3 = listBody.items[2];
check("productos reales para el flujo", Boolean(p1 && p2 && p3));
if (!p1 || !p2 || !p3) process.exit(1);

// 4) Favoritos: add (upsert) + sync + delete --------------------------------
const favRes = await app.request("/api/me/favorites", {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: p1.id, note: "Para navidad" }),
});
const favBody = (await favRes.json()) as any;
check("POST favorites 201 con savedPriceCents real", favRes.status === 201 && favBody.favorite.savedPriceCents === p1.bestPriceCents, favBody);
check("nota guardada", favBody.favorite.note === "Para navidad");

const favAgainRes = await app.request("/api/me/favorites", {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: p1.id, note: "Nota actualizada" }),
});
const favAgain = (await favAgainRes.json()) as any;
check("re-add favorito = upsert 201 (mismo registro, nota actualizada)", favAgainRes.status === 201 && favAgain.favorite.note === "Nota actualizada");

const syncRes = await app.request("/api/me/favorites/sync", {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productIds: [p1.id, p2.id] }),
});
const syncBody = (await syncRes.json()) as any;
check("sync añade p2 y preserva p1", syncRes.status === 200 && syncBody.added === 1 && syncBody.skipped === 1, syncBody);

const delFavRes = await app.request(`/api/me/favorites/${p2.id}`, { method: "DELETE", headers: authHeaders });
check("DELETE favorite 200", delFavRes.status === 200);
const delFavAgain = await app.request(`/api/me/favorites/${p2.id}`, { method: "DELETE", headers: authHeaders });
check("DELETE favorite inexistente → 404", delFavAgain.status === 404);

// 5) Listas: crear, ítems con upsert de cantidad -----------------------------
const listCreateRes = await app.request("/api/me/lists", {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ name: "Setup gamer", description: "Presupuesto de diciembre" }),
});
const listCreated = (await listCreateRes.json()) as any;
check("POST lists 201", listCreateRes.status === 201 && listCreated.list.name === "Setup gamer");
const listId = listCreated.list.id;

const itemRes = await app.request(`/api/me/lists/${listId}/items`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: p1.id, quantity: 2 }),
});
const itemBody = (await itemRes.json()) as any;
check("POST item 201 hidratado", itemRes.status === 201 && itemBody.item.product.slug === p1.slug && itemBody.item.quantity === 2, itemBody.item?.product?.slug);

const itemUpsertRes = await app.request(`/api/me/lists/${listId}/items`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: p1.id, quantity: 3 }),
});
const itemUpsert = (await itemUpsertRes.json()) as any;
check("re-add ítem = upsert quantity 3", itemUpsertRes.status === 201 && itemUpsert.item.quantity === 3);

const item2Res = await app.request(`/api/me/lists/${listId}/items`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: p2.id, quantity: 1 }),
});
check("segundo ítem 201", item2Res.status === 201);

const itemNotFound = await app.request(`/api/me/lists/${listId}/items`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: "00000000-0000-4000-8000-000000000000" }),
});
check("ítem con producto inexistente → 404", itemNotFound.status === 404);
const foreignList = await app.request(`/api/me/lists/00000000-0000-4000-8000-000000000000/items`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ productId: p1.id }),
});
check("ítem en lista ajena → 404", foreignList.status === 404);

// 6) Alerta vinculada al usuario autenticado ---------------------------------
const alertRes = await app.request("/api/alerts", {
  method: "POST",
  headers: { ...authHeaders, ...(await captchaHeaders()) },
  body: JSON.stringify({ productId: p3.id, email: TEST_EMAIL, targetPriceCents: Math.round(p3.bestPriceCents * 0.9) }),
});
const alertBody = (await alertRes.json()) as any;
check("POST /api/alerts (con sesión) 201", alertRes.status === 201);
const [alertRow] = await db
  .select({ userId: sql<string | null>`user_id` })
  .from(sql`price_alerts`)
  .where(sql`id = ${alertBody.alert.id}`) as any;
check("alerta vinculada con userId de la sesión", alertRow?.userId === userId, { alertUserId: alertRow?.userId, userId });

// Alerta creada SIN sesión con el mismo email (propiedad por email)
const guestAlertRes = await app.request("/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json", ...(await captchaHeaders()) },
  body: JSON.stringify({ productId: p2.id, email: TEST_EMAIL, targetPriceCents: Math.round(p2.bestPriceCents * 0.8) }),
});
const guestAlert = (await guestAlertRes.json()) as any;
check("alerta invitada (sin sesión) 201", guestAlertRes.status === 201);

// 7) Overview con todo -------------------------------------------------------
const overviewRes = await app.request("/api/me/overview", { headers: authHeaders });
const overview = (await overviewRes.json()) as any;
check("GET overview 200", overviewRes.status === 200);
check("overview.user coincide", overview.user.id === userId && overview.user.email === TEST_EMAIL);
check("stats.favoritesCount=1", overview.stats.favoritesCount === 1, overview.stats);
check("stats.activeAlertsCount=2 (auth + email)", overview.stats.activeAlertsCount === 2, overview.stats.activeAlertsCount);
check("stats.listsCount=1", overview.stats.listsCount === 1);
const fav = overview.favorites[0];
check(
  "favorito hidratado como ProductSummaryDTO completo",
  fav.product.slug === p1.slug &&
    fav.product.listings?.length > 0 &&
    fav.product.bestPriceCents > 0 &&
    typeof fav.product.savingsPercent === "number" &&
    fav.priceChangeSinceSavedCents === fav.currentBestPriceCents - fav.savedPriceCents,
  fav.product?.slug
);
const uList = overview.lists[0];
const expectedTotalBest = p1.bestPriceCents * 3 + p2.bestPriceCents * 1;
const expectedTotalHighest = p1.highestPriceCents * 3 + p2.highestPriceCents * 1;
check(
  "lista con totales por cantidad (best×qty + highest×qty)",
  uList.itemCount === 2 &&
    uList.totalBestPriceCents === expectedTotalBest &&
    uList.totalHighestPriceCents === expectedTotalHighest &&
    uList.totalSavingsCents === Math.max(0, expectedTotalHighest - expectedTotalBest),
  { total: uList.totalBestPriceCents, esperado: expectedTotalBest, savings: uList.totalSavingsCents }
);
const overAlerts = overview.alerts;
check(
  "2 alertas en overview con reachedTarget y producto hidratado",
  overAlerts.length === 2 &&
    overAlerts.every((a: any) => typeof a.reachedTarget === "boolean" && a.product.canonicalName && a.product.bestStoreName),
  overAlerts.map((a: any) => a.product.bestStoreName)
);
check(
  "reachedTarget correcto (targets ABOVE current price => true)",
  overAlerts.every((a: any) => a.reachedTarget === (a.product.currentBestPriceCents <= a.targetPriceCents)),
  overAlerts.map((a: any) => `${a.targetPriceCents}<${a.product.currentBestPriceCents}`)
);
check(
  "stats.totalPotentialSavingsCents = ahorro de listas",
  overview.stats.totalPotentialSavingsCents === uList.totalSavingsCents,
  { stat: overview.stats.totalPotentialSavingsCents, lista: uList.totalSavingsCents }
);

// 8) PATCH/DELETE de alertas (propiedad userId y email) ----------------------
const patchRes = await app.request(`/api/me/alerts/${alertBody.alert.id}`, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ targetPriceCents: 12345, active: false }),
});
const patched = (await patchRes.json()) as any;
check("PATCH alerta (por userId) 200", patchRes.status === 200 && patched.alert.targetPriceCents === 12345 && patched.alert.active === false, patched);

const patchGuestRes = await app.request(`/api/me/alerts/${guestAlert.alert.id}`, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ targetPriceCents: 999 }),
});
const patchedGuest = (await patchGuestRes.json()) as any;
check("PATCH alerta invitada (por email) 200", patchGuestRes.status === 200 && patchedGuest.alert.targetPriceCents === 999, patchedGuest);

const patchForeign = await app.request(`/api/me/alerts/00000000-0000-4000-8000-000000000000`, {
  method: "PATCH",
  headers: authHeaders,
  body: JSON.stringify({ active: true }),
});
check("PATCH alerta ajena → 404", patchForeign.status === 404);

const delAlertRes = await app.request(`/api/me/alerts/${alertBody.alert.id}`, { method: "DELETE", headers: authHeaders });
check("DELETE alerta 200", delAlertRes.status === 200);
const delGuestAlert = await app.request(`/api/me/alerts/${guestAlert.alert.id}`, { method: "DELETE", headers: authHeaders });
check("DELETE alerta invitada (email) 200", delGuestAlert.status === 200);

// 9) Limpieza de ítems/lista/favorito ----------------------------------------
const delItemRes = await app.request(`/api/me/lists/${listId}/items/${p1.id}`, { method: "DELETE", headers: authHeaders });
check("DELETE ítem 200", delItemRes.status === 200);
const delListRes = await app.request(`/api/me/lists/${listId}`, { method: "DELETE", headers: authHeaders });
check("DELETE lista 200", delListRes.status === 200);
const delFav1 = await app.request(`/api/me/favorites/${p1.id}`, { method: "DELETE", headers: authHeaders });
check("DELETE favorito restante 200", delFav1.status === 200);

const finalOverview = (await (
  await app.request("/api/me/overview", { headers: authHeaders })
).json()) as any;
check(
  "overview final vacío (0 favoritos, 0 listas, 0 alertas)",
  finalOverview.stats.favoritesCount === 0 &&
    finalOverview.stats.listsCount === 0 &&
    finalOverview.stats.activeAlertsCount === 0,
  finalOverview.stats
);

// 10) Cleanup del usuario de prueba -------------------------------------------
await db.execute(sql`delete from price_alerts where email = ${TEST_EMAIL}`);
await db.execute(sql`delete from "user" where email = ${TEST_EMAIL}`);
const [leftover] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`"user"`)
  .where(sql`email = ${TEST_EMAIL}`) as any;
check("usuario de prueba eliminado", (leftover?.total ?? 0) === 0);

console.log(
  failures === 0
    ? "\n🎉 MI ESPACIO: TODAS LAS VERIFICACIONES PASARON"
    : `\n💥 ${failures} verificaciones fallaron`
);
process.exit(failures === 0 ? 0 : 1);
