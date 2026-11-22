// ============================================================================
// Better Auth — email + password sobre PostgreSQL (Drizzle adapter, pg).
// Soporta cookies cross-subdomain (app.regateoapp.com <-> api.regateoapp.com)
// cuando COOKIE_DOMAIN está definido.
// ============================================================================
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
const baseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.API_URL ??
  `http://localhost:${process.env.PORT ?? 3001}`;

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined;

export const auth = betterAuth({
  baseURL,
  secret: resolveAuthSecret(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
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
<p>Hola ${target.name}. Recibimos una solicitud para restablecer la contraseña de tu cuenta Regateo.</p>
<p><a href="${resetUrl}" style="display:inline-block;background:#e11d48;color:#fff;padding:0.75rem 1.5rem;border-radius:0.5rem;text-decoration:none">Crear nueva contraseña</a></p>
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
    "http://localhost:5173",
    "http://localhost:4173",
    ...(cookieDomain ? [`https://${cookieDomain}`, `https://app.${cookieDomain}`] : []),
  ],
  advanced: {
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : undefined,
    defaultCookieAttributes: cookieDomain
      ? { sameSite: "none" }
      : { sameSite: "lax" },
  },
});

/** Handler crudo para Hono (request -> Response). */
export async function authHandler(request: Request): Promise<Response> {
  return auth.handler(request);
}

/** Sesión opcional (null si no hay cookie válida). */
export async function getSessionUser(headers: Headers) {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}
