// ============================================================================
// Verificación real del CAPTCHA anti-bot (Sprint 5) contra app.request:
// 403 sin captcha, 200 con captcha resuelto, anti-replay, honeypot, firma
// alterada, expiración firmada, CORS de headers, y sesión sin captcha.
// Limpia todo al final. Ejecutar: bun scripts/verify-captcha.ts
// ============================================================================
import { createHmac } from "node:crypto";
import { app } from "../src/app";
import { db, sql } from "@regateo/db";

const TEST_EMAIL = `captcha-test-${Date.now()}@regateo.test`;
let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}

function solve(body: any): { token: string; answer: string } {
  const match = body.challenge.question.match(/(\d+) \+ (\d+)/);
  return {
    token: body.challenge.token,
    answer: String(Number(match[1]) + Number(match[2])),
  };
}
async function freshChallenge(): Promise<any> {
  const res = await app.request("/api/security/captcha");
  return (await res.json()) as any;
}

// 1) Config pública ---------------------------------------------------------
const captchaInfo = await freshChallenge();
check(
  "GET /api/security/captcha 200 builtin con challenge",
  captchaInfo.provider === "builtin" &&
    captchaInfo.challenge?.challengeId &&
    /\d+ \+ \d+/.test(captchaInfo.challenge.question) &&
    captchaInfo.challenge.token.includes(".") &&
    typeof captchaInfo.challenge.expiresAt === "string",
  captchaInfo
);

// CORS: headers de captcha permitidos en preflight
const preflight = await app.request("/api/security/captcha", {
  method: "OPTIONS",
  headers: {
    origin: "http://localhost:5173",
    "access-control-request-method": "POST",
    "access-control-request-headers":
      "content-type,x-captcha-token,x-captcha-answer,x-captcha-hp",
  },
});
const allowHeaders = preflight.headers.get("access-control-allow-headers") ?? "";
check(
  "CORS permite x-captcha-token/answer/hp",
  (preflight.status === 200 || preflight.status === 204) &&
    ["x-captcha-token", "x-captcha-answer", "x-captcha-hp"].every((header) =>
      allowHeaders.toLowerCase().includes(header)
    ),
  { allowHeaders }
);

// 2) 403 sin captcha --------------------------------------------------------
const signinNoCaptcha = await app.request("/api/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL, password: "no-importa-123" }),
});
const signinNoCaptchaBody = (await signinNoCaptcha.json()) as any;
check(
  "POST /api/auth/sign-in/email SIN captcha → 403 captcha_failed",
  signinNoCaptcha.status === 403 && signinNoCaptchaBody.error === "captcha_failed",
  { status: signinNoCaptcha.status, body: signinNoCaptchaBody }
);
check(
  "mensaje exacto del brief",
  signinNoCaptchaBody.message ===
    "Verificación anti-bot inválida o expirada. Completa el captcha e intenta de nuevo."
);

// Producto real para /api/alerts
const productsRes = await app.request("/api/products?limit=1");
const product = ((await productsRes.json()) as any).items[0];
check("producto real obtenido", Boolean(product));

const alertsNoCaptcha = await app.request("/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: Math.round(product.bestPriceCents * 0.9),
  }),
});
check(
  "POST /api/alerts SIN captcha → 403 captcha_failed",
  alertsNoCaptcha.status === 403 &&
    ((await alertsNoCaptcha.json()) as any).error === "captcha_failed",
  alertsNoCaptcha.status
);

// 3) Flujo completo CON captcha ---------------------------------------------
const signupChallenge = await freshChallenge();
const signupSolution = solve(signupChallenge);
const signup = await app.request("/api/auth/sign-up/email", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:5173",
    "x-captcha-token": signupSolution.token,
    "x-captcha-answer": signupSolution.answer,
  },
  body: JSON.stringify({
    name: "Captcha Tester",
    email: TEST_EMAIL,
    password: "captcha-test-12345",
  }),
});
const signupBody = (await signup.json()) as any;
check("signup CON captcha resuelto → pasa (200/201)", signup.status === 200 || signup.status === 201, { status: signup.status, body: signupBody });

const signinChallenge = await freshChallenge();
const signinSolution = solve(signinChallenge);
const signin = await app.request("/api/auth/sign-in/email", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:5173",
    "x-captcha-token": signinSolution.token,
    "x-captcha-answer": signinSolution.answer,
  },
  body: JSON.stringify({ email: TEST_EMAIL, password: "captcha-test-12345" }),
});
const cookie = (signin.headers.getSetCookie?.() ?? [])
  .map((value: string) => value.split(";")[0])
  .join("; ");
check("signin CON captcha → 200 con cookie", signin.status === 200 && cookie.includes("session_token"), signin.status);

// get-session y sign-out SIN captcha siguen funcionando
const session = await app.request("/api/auth/get-session", { headers: { cookie } });
const sessionBody = (await session.json()) as any;
check("get-session SIN captcha → 200 sesión válida", session.status === 200 && sessionBody.user?.email === TEST_EMAIL);
const signOut = await app.request("/api/auth/sign-out", {
  method: "POST",
  headers: { cookie, origin: "http://localhost:5173" },
});
check("sign-out SIN captcha → pasa (no bloqueado)", signOut.status === 200 || signOut.status === 204, signOut.status);

// POST /api/alerts con captcha → 201 (usa challenge nuevo)
const alertChallenge = await freshChallenge();
const alertSolution = solve(alertChallenge);
const alertOk = await app.request("/api/alerts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-captcha-token": alertSolution.token,
    "x-captcha-answer": alertSolution.answer,
  },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: Math.round(product.bestPriceCents * 0.9),
  }),
});
check("POST /api/alerts CON captcha → 201", alertOk.status === 201, alertOk.status);

// 4) Anti-replay: reutilizar el MISMO token → 403 ---------------------------
const replay = await app.request("/api/alerts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-captcha-token": alertSolution.token,
    "x-captcha-answer": alertSolution.answer,
  },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: Math.round(product.bestPriceCents * 0.9),
  }),
});
check(
  "replay del mismo token → 403 (anti-replay)",
  replay.status === 403 && ((await replay.json()) as any).error === "captcha_failed",
  replay.status
);

// 5) Casos negativos (a través de /api/alerts) ------------------------------
const hpChallenge = await freshChallenge();
const hpSolution = solve(hpChallenge);
const honeypot = await app.request("/api/alerts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-captcha-token": hpSolution.token,
    "x-captcha-answer": hpSolution.answer,
    "x-captcha-hp": "http://spam.example",
  },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: 100,
  }),
});
check("honeypot lleno → 403 (bot_detected)", honeypot.status === 403, honeypot.status);

const wrongChallenge = await freshChallenge();
const wrongToken = wrongChallenge.challenge.token;
const wrong = await app.request("/api/alerts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-captcha-token": wrongToken,
    "x-captcha-answer": "99",
  },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: 100,
  }),
});
check("respuesta incorrecta → 403 (wrong_answer)", wrong.status === 403, wrong.status);

const tampered = wrongToken.slice(0, -2) + (wrongToken.endsWith("aa") ? "bb" : "aa");
const tamperedRes = await app.request("/api/alerts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-captcha-token": tampered,
    "x-captcha-answer": solve(wrongChallenge).answer,
  },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: 100,
  }),
});
check("firma HMAC alterada → 403 (bad_signature)", tamperedRes.status === 403, tamperedRes.status);

// Token expirado firmado correctamente (HMAC con el secreto real del env)
const secret = process.env.BETTER_AUTH_SECRET as string;
const expiredPayload = `expired-nonce-123:7:${Date.now() - 60_000}`;
const expiredToken = `${expiredPayload}.${createHmac("sha256", secret).update(expiredPayload).digest("hex")}`;
const expiredRes = await app.request("/api/alerts", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-captcha-token": expiredToken,
    "x-captcha-answer": "7",
  },
  body: JSON.stringify({
    productId: product.id,
    email: TEST_EMAIL,
    targetPriceCents: 100,
  }),
});
check("token expirado con firma válida → 403 (expired)", expiredRes.status === 403, expiredRes.status);

const garbage = await app.request("/api/alerts", {
  method: "POST",
  headers: { "content-type": "application/json", "x-captcha-token": "garbage" },
  body: JSON.stringify({ productId: product.id, email: TEST_EMAIL, targetPriceCents: 100 }),
});
check("token malformado → 403 (bad_format)", garbage.status === 403, garbage.status);

// 6) Cleanup -----------------------------------------------------------------
await db.execute(sql`delete from price_alerts where email = ${TEST_EMAIL}`);
await db.execute(sql`delete from "user" where email = ${TEST_EMAIL}`);
const [leftoverUser] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`"user"`)
  .where(sql`email = ${TEST_EMAIL}`) as any;
const [leftoverAlerts] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(sql`price_alerts`)
  .where(sql`email = ${TEST_EMAIL}`) as any;
check("cleanup completo (0 usuarios, 0 alertas)", (leftoverUser?.total ?? 0) === 0 && (leftoverAlerts?.total ?? 0) === 0);

console.log(
  failures === 0
    ? "\n🎉 CAPTCHA: TODAS LAS VERIFICACIONES PASARON"
    : `\n💥 ${failures} verificaciones fallaron`
);
process.exit(failures === 0 ? 0 : 1);
