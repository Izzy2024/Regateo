// ============================================================================
// Protección Anti-Bot / CAPTCHA (Sprint 5) — dos modos transparentes:
//   • turnstile: TURNSTILE_SECRET_KEY definido → Cloudflare Turnstile siteverify
//   • builtin:   sin Turnstile → desafío humano ligero firmado HMAC-SHA256
//                (BETTER_AUTH_SECRET) con nonce único anti-replay y TTL 5 min.
// Más honeypot (`x-captcha-hp`) y middleware Hono listo para usar.
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { logger } from "./observability";

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY?.trim() || undefined;
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY?.trim() || undefined;
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const HMAC_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  "dev-regateoapp-super-secret-key-change-in-production-32chars";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Config pública (para que el frontend sepa qué renderizar)
// ---------------------------------------------------------------------------
export type CaptchaProvider = "turnstile" | "builtin";

export function getCaptchaPublicConfig(): {
  provider: CaptchaProvider;
  siteKey: string | null;
} {
  return {
    provider: TURNSTILE_SECRET_KEY ? "turnstile" : "builtin",
    siteKey: TURNSTILE_SITE_KEY ?? null,
  };
}

// ---------------------------------------------------------------------------
// Desafío integrado firmado (modo builtin)
// ---------------------------------------------------------------------------
export interface BuiltinChallenge {
  provider: "builtin";
  challengeId: string;
  question: string;
  token: string;
  expiresAt: string;
}

function hmacHex(payload: string): string {
  return createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** No capturables por regex inversa de la pregunta: 2..9 + 1..9. */
function randomSmallInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function createBuiltinChallenge(): BuiltinChallenge {
  const a = randomSmallInt(2, 9);
  const b = randomSmallInt(1, 9);
  const answer = a + b;
  const nonce = crypto.randomUUID();
  const expiresAtMs = Date.now() + CHALLENGE_TTL_MS;

  // Nunca exponer la respuesta en texto plano dentro del token:
  // firmamos (nonce:answer:expiresAtMs) pero solo emitimos (nonce:expiresAtMs.sig).
  const signedInput = `${nonce}:${answer}:${expiresAtMs}`;
  const publicPayload = `${nonce}:${expiresAtMs}`;
  const token = `${publicPayload}.${hmacHex(signedInput)}`;

  return {
    provider: "builtin",
    challengeId: nonce,
    question: `¿Cuánto es ${a} + ${b}?`,
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Nonces usados (anti-replay) con limpieza automática
// ---------------------------------------------------------------------------
const usedNonces = new Map<string, number>(); // nonce -> expiresAt (ms)

/** Poda no-replay: se eliminan los nonces ya expirados en cada verificación. */
function pruneUsedNonces(now: number): void {
  if (usedNonces.size === 0) return;
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt < now) usedNonces.delete(nonce);
  }
}

// ---------------------------------------------------------------------------
// Verificación unificada
// ---------------------------------------------------------------------------
export interface VerifyCaptchaInput {
  token: string | undefined | null;
  answer?: string | null;
  honeypot?: string | null;
  remoteIp?: string | null;
}

export type CaptchaFailureReason =
  | "bot_detected"
  | "missing_token"
  | "missing_answer"
  | "bad_format"
  | "bad_signature"
  | "expired"
  | "replayed"
  | "wrong_answer"
  | "provider_error";

export type CaptchaResult =
  | { ok: true }
  | { ok: false; reason: CaptchaFailureReason };

async function verifyTurnstile(
  token: string,
  remoteIp?: string | null
): Promise<CaptchaResult> {
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY as string, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data?.success === true) return { ok: true };
    logger.warn("captcha_turnstile_rejected", { errors: data?.["error-codes"] ?? [] });
    return { ok: false, reason: "provider_error" };
  } catch (error) {
    logger.error("captcha_turnstile_unreachable", {
      message: error instanceof Error ? error.message : String(error),
    });
    // Fail-closed: si Cloudflare no responde, no dejamos pasar el bot.
    return { ok: false, reason: "provider_error" };
  }
}

function verifyBuiltin(token: string, answer?: string | null): CaptchaResult {
  const now = Date.now();

  const signatureIndex = token.lastIndexOf(".");
  if (signatureIndex <= 0 || signatureIndex === token.length - 1) {
    return { ok: false, reason: "bad_format" };
  }
  const publicPayload = token.slice(0, signatureIndex);
  const signature = token.slice(signatureIndex + 1);

  const parts = publicPayload.split(":");
  if (parts.length !== 2) return { ok: false, reason: "bad_format" };
  const [nonce, rawExpiresAt] = parts;
  const expiresAtMs = Number(rawExpiresAt);
  if (!nonce || !Number.isFinite(expiresAtMs)) {
    return { ok: false, reason: "bad_format" };
  }

  if (now > expiresAtMs) return { ok: false, reason: "expired" };

  pruneUsedNonces(now);
  if (usedNonces.has(nonce)) return { ok: false, reason: "replayed" };

  if (answer === undefined || answer === null || answer.trim() === "") {
    return { ok: false, reason: "missing_answer" };
  }
  const numericAnswer = Number(answer.trim());
  if (!Number.isFinite(numericAnswer)) {
    return { ok: false, reason: "wrong_answer" };
  }

  const expectedSig = hmacHex(`${nonce}:${numericAnswer}:${expiresAtMs}`);
  if (!timingSafeHexEqual(signature, expectedSig)) {
    return { ok: false, reason: "wrong_answer" };
  }

  // Consumido: el nonce jamás podrá usarse de nuevo (hasta su expiración).
  usedNonces.set(nonce, expiresAtMs);
  return { ok: true };
}

export async function verifyCaptcha(
  input: VerifyCaptchaInput
): Promise<CaptchaResult> {
  // 1) Honeypot: cualquier carácter = bot. Respuesta uniforme 403 sin detalle.
  if ((input.honeypot ?? "").length > 0) {
    return { ok: false, reason: "bot_detected" };
  }

  if (!input.token) return { ok: false, reason: "missing_token" };

  // 2) Turnstile (producción)
  if (TURNSTILE_SECRET_KEY) {
    return verifyTurnstile(input.token, input.remoteIp);
  }

  // 3) Desafío integrado
  return verifyBuiltin(input.token, input.answer);
}

// ---------------------------------------------------------------------------
// Middleware Hono
// ---------------------------------------------------------------------------
export const CAPTCHA_FAILED_RESPONSE = {
  error: "captcha_failed",
  message:
    "Verificación anti-bot inválida o expirada. Completa el captcha e intenta de nuevo.",
} as const;

export const requireCaptchaMiddleware: MiddlewareHandler = async (c, next) => {
  const token = c.req.header("x-captcha-token");
  const answer = c.req.header("x-captcha-answer");
  const honeypot = c.req.header("x-captcha-hp");
  const remoteIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (!token) {
    return c.json(CAPTCHA_FAILED_RESPONSE, 403);
  }

  const result = await verifyCaptcha({ token, answer, honeypot, remoteIp });
  if (!result.ok) {
    logger.warn("captcha_failed", {
      reason: result.reason,
      path: c.req.path,
    });
    return c.json(CAPTCHA_FAILED_RESPONSE, 403);
  }

  await next();
};
