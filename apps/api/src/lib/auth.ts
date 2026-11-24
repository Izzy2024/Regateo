// ============================================================================
// Better Auth — email + password sobre PostgreSQL (Drizzle adapter, pg).
// Soporta cookies cross-subdomain (app.regateoapp.com <-> api.regateoapp.com)
// cuando COOKIE_DOMAIN está definido.
// ============================================================================
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  db,
  user,
  session,
  account,
  verification,
} from "@regateo/db";
import { logger } from "./observability";

const DEV_SECRET_PLACEHOLDER =
  "dev-regateoapp-super-secret-key-change-in-production-32chars";

/** Fail-fast (auditoría #7): en producción jamás arrancamos con placeholder. */
function resolveAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret === DEV_SECRET_PLACEHOLDER)) {
    throw new Error(
      "[RegateoApp] FATAL: BETTER_AUTH_SECRET falta o sigue siendo el placeholder de desarrollo. Configura un secreto real antes de desplegar."
    );
  }
  return secret ?? DEV_SECRET_PLACEHOLDER;
}

const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined;
const isProduction = process.env.NODE_ENV === "production";
const neonFunctionApiUrl =
  process.env.NEON_BRANCH_ID && process.env.NEON_FUNCTION_HOST_SUFFIX
    ? `https://${process.env.NEON_BRANCH_ID}-api${process.env.NEON_FUNCTION_HOST_SUFFIX}`
    : undefined;
const baseURL =
  process.env.BETTER_AUTH_URL ??
  neonFunctionApiUrl ??
  process.env.API_URL ??
  `http://localhost:${process.env.PORT ?? 3001}`;

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Correo de bienvenida al registrarse vía Resend (fire-and-forget). */
async function sendWelcomeEmail(target: { email: string; name?: string | null }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || !target.email) return;

  const firstName = escapeHtml((target.name?.trim() || "ahorrador").split(/\s+/)[0] || "ahorrador");
  const from =
    process.env.EMAIL_FROM?.trim() ||
    process.env.ALERTS_FROM_EMAIL?.trim() ||
    "Regateo <hola@regateo.org>";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: target.email,
      subject: "¡Bienvenido a Regateo! Empieza a comparar precios en Panamá",
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:2rem auto;padding:1.5rem;border:1px solid #e7e5df;border-radius:14px;color:#111315;background:#ffffff">
  <h2 style="margin:0 0 0.75rem;font-size:1.35rem;color:#111315">¡Hola ${firstName}, bienvenido a Regateo!</h2>
  <p style="margin:0 0 1rem;color:#525866;line-height:1.55">Tu cuenta ya está activa. Ahora puedes comparar precios reales en <strong>14 tiendas de electrónica de Panamá</strong>, guardar favoritos, armar listas de presupuesto y crear alertas cuando bajen de precio.</p>
  <p style="margin:1.25rem 0"><a href="${webUrl}" style="display:inline-block;background:#E64825;color:#ffffff;font-weight:600;padding:0.75rem 1.4rem;border-radius:8px;text-decoration:none">Explorar ofertas en Regateo</a></p>
  <p style="margin:1.25rem 0 0;color:#666D7C;font-size:0.82rem;line-height:1.45">¿Falta tu tienda favorita? Puedes sugerirla directo desde la web.<br>— El equipo de Regateo (${webUrl.replace(/^https?:\/\//, "")})</p>
</div>`,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((error) => {
    logger.warn("welcome_email_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export const auth = betterAuth({
  baseURL,
  secret: resolveAuthSecret(),
  plugins: [bearer()],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          void sendWelcomeEmail({
            email: createdUser.email,
            name: createdUser.name,
          });
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // Restablecimiento de contraseña: URL hacia el FRONTEND con el token
    sendResetPassword: async ({ user: target, token }) => {
      const resetUrl = `${webUrl}/?resetToken=${token}`;
      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (apiKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from:
              process.env.ALERTS_FROM_EMAIL ??
              "Regateo <onboarding@resend.dev>",
            to: target.email,
            subject: "Restablece tu contraseña — Regateo",
            html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;color:#0f172a">
<h2>Restablece tu contraseña</h2>
<p>Hola ${escapeHtml(target.name || "")}. Recibimos una solicitud para restablecer la contraseña de tu cuenta Regateo.</p>
<p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#e11d48;color:#fff;padding:0.75rem 1.5rem;border-radius:0.5rem;text-decoration:none">Crear nueva contraseña</a></p>
<p style="color:#64748b;font-size:0.85rem">Si no fuiste tú, ignora este correo y tu contraseña seguirá igual.</p>
</div>`,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch((error) => {
          logger.warn("password_reset_email_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      } else {
        // Sin RESEND_API_KEY en local: log estructurado con el enlace (pruebas)
        logger.info("password_reset_local", {
          email: target.email,
          resetUrl,
        });
      }
    },
  },
  // Google OAuth: se activa automáticamente con GOOGLE_CLIENT_ID/SECRET
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: { clientId: googleClientId, clientSecret: googleClientSecret },
        },
      }
    : {}),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // refrescar sesión una vez al día
  },
  trustedOrigins: [
    webUrl,
    "https://regateo.org",
    "https://www.regateo.org",
    ...(!isProduction ? ["http://localhost:5173", "http://localhost:4173"] : []),
    "https://*.regateo.pa",
    "https://*.regateo.org",
    ...(process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ...(cookieDomain ? [`https://${cookieDomain}`, `https://app.${cookieDomain}`] : []),
  ],
  advanced: {
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : undefined,
    defaultCookieAttributes:
      cookieDomain || isProduction
        ? { sameSite: "none", secure: true }
        : { sameSite: "lax" },
  },
});

/** Handler crudo para Hono (request -> Response). */
export async function authHandler(request: Request): Promise<Response> {
  return auth.handler(request);
}

// ---------------------------------------------------------------------------
// Neon Auth (Managed Better Auth JWKS) — verificación opcional de Bearer JWT
// junto con la sesión de cookies de Better Auth.
// ---------------------------------------------------------------------------
let cachedJwksUrl: string | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function getNeonAuthConfig() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim() || null;
  const jwksUrl =
    process.env.NEON_AUTH_JWKS_URL?.trim() ||
    (baseUrl ? `${baseUrl.replace(/\/+$/, "")}/.well-known/jwks.json` : null);
  return {
    configured: Boolean(baseUrl && jwksUrl),
    baseUrl,
    jwksUrl,
  };
}

function getNeonAuthJwks() {
  const { jwksUrl } = getNeonAuthConfig();
  if (!jwksUrl) return null;
  if (!cachedJwks || cachedJwksUrl !== jwksUrl) {
    cachedJwksUrl = jwksUrl;
    cachedJwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return cachedJwks;
}

async function verifyNeonAuthBearer(headers: Headers) {
  const header = headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const { baseUrl } = getNeonAuthConfig();
  const jwks = getNeonAuthJwks();
  if (!baseUrl || !jwks) return null;

  try {
    const origin = new URL(baseUrl).origin;
    const { payload } = await jwtVerify(token, jwks, {
      issuer: origin,
      audience: origin,
    });
    if (!payload.sub) return null;
    const email =
      typeof payload.email === "string" ? payload.email : `${payload.sub}@neon-auth.local`;
    const name =
      typeof payload.name === "string" ? payload.name : email.split("@")[0] || "Usuario";
    const image = typeof payload.image === "string" ? payload.image : null;
    return {
      user: {
        id: payload.sub,
        name,
        email,
        image,
      },
      session: {
        id: typeof payload.jti === "string" ? payload.jti : `neon-jwt:${payload.sub}`,
        userId: payload.sub,
      },
    };
  } catch {
    return null;
  }
}

/** Sesión opcional (cookie de Better Auth o Bearer JWT de Neon Auth). */
export async function getSessionUser(headers: Headers) {
  try {
    const cookieSession = await auth.api.getSession({ headers });
    if (cookieSession?.user) return cookieSession;
  } catch {
    // Continuamos al fallback de Neon Auth JWT si existe.
  }
  return verifyNeonAuthBearer(headers);
}
