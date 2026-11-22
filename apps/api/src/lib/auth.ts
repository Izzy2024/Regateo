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
  },
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
