// ============================================================================
// @regateo/api — Hono app con todas las rutas encadenadas (RPC AppType).
// ============================================================================
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ZodError } from "zod";
import {
  addListItemSchema,
  aiChatRequestSchema,
  createFavoriteSchema,
  createPriceAlertSchema,
  createShoppingListSchema,
  formatUsdFromCents,
  productSearchQuerySchema,
  reportWrongPriceSchema,
  syncFavoritesSchema,
  triggerScrapeSchema,
  updateAlertSchema,
  type ProductSearchQuery,
} from "@regateo/shared";
import {
  db,
  and,
  desc,
  eq,
  sql,
  priceAlerts,
  priceReports,
  products,
  storeListings,
  stores,
  outboundClicks,
} from "@regateo/db";
import "./env";
import {
  cacheBackend,
  cacheGetOrSet,
  cacheInvalidatePrefix,
  rateLimitMiddleware,
} from "./lib/cache";
import {
  captureException,
  structuredLogger,
  logger,
} from "./lib/observability";
import { authHandler, getSessionUser } from "./lib/auth";
import {
  createBuiltinChallenge,
  getCaptchaPublicConfig,
  requireCaptchaMiddleware,
} from "./lib/captcha";
import {
  createPriceAlert,
  getBestDeals,
  getLastScrapedAt,
  getProductBySlug,
  getSimilarProductsForSlug,
  getStoresStatus,
  productExistsById,
  searchProducts,
  type ScrapeRunDTO,
} from "./services/catalog";
import { aiChatHandler } from "./routes/ai";
import {
  addItemToUserList,
  addUserFavorite,
  createUserList,
  deleteUserAlert,
  deleteUserList,
  getUserOverview,
  listUserAlerts,
  removeItemFromUserList,
  removeUserFavorite,
  syncUserFavorites,
  updateUserAlert,
  type MeUser,
} from "./services/user-space";

const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// App base: CORS + logging + errores
// ---------------------------------------------------------------------------
export interface AppEnv {
  Variables: { meUser: MeUser };
}

const app = new Hono<AppEnv>();

/** Guardián de sesión para /api/me/* y /api/alerts (auditoría #3/#9): 401 uniforme. */
const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await getSessionUser(c.req.raw.headers);
  if (!session?.user) {
    return c.json(
      { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
      401
    );
  }
  c.set("meUser", {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
  });
  await next();
};

/** Correo de confirmación de alerta vía Resend (fire-and-forget). */
async function sendAlertConfirmationEmail(
  to: string,
  confirmUrl: string,
  productName: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return; // sin API key el token queda disponible por el enlace en dev
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from:
        process.env.EMAIL_FROM ?? "RegateoApp <onboarding@resend.dev>",
      to,
      subject: "Confirma tu alerta de precio — RegateoApp",
      html: `<p>Hola! Solicitaste una alerta de precio para <strong>${productName}</strong>.</p><p>Confírmala aquí: <a href="${confirmUrl}">Activar mi alerta</a></p><p>Si no fuiste tú, ignora este correo.</p>`,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((error) => {
    logger.warn("alert_confirmation_email_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return webUrl;
      if (origin === webUrl) return origin;
      if (
        !isProduction &&
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
      ) {
        return origin;
      }
      return webUrl;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-cron-secret",
      "x-manual-trigger",
      "x-captcha-token",
      "x-captcha-answer",
      "x-captcha-hp",
    ],
    exposeHeaders: ["Content-Type"],
  })
);

app.use("*", structuredLogger);

app.onError((error, c) => {
  captureException(error, { path: c.req.path, method: c.req.method });
  logger.error("unhandled_error", {
    message: error instanceof Error ? error.message : String(error),
    path: c.req.path,
  });
  return c.json(
    {
      error: "internal_error",
      message: isProduction ? undefined : (error as Error).message,
    },
    500
  );
});

app.notFound((c) =>
  c.json({ error: "not_found", message: `Ruta no encontrada: ${c.req.path}` }, 404)
);

// Hook de validación uniforme (400 con detalles Zod)
function validationHook(result: { success: boolean; error?: ZodError }, c: any) {
  if (!result.success) {
    return c.json(
      {
        error: "validation_error",
        message: "Los parámetros enviados no son válidos.",
        details: result.error?.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400
    );
  }
}

const dealsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

const similarQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const triggerScrapeQuerySchema = z.object({
  wait: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

// ---------------------------------------------------------------------------
// Rutas encadenadas (el orden importa: /api/products/deals antes de :slug)
// ---------------------------------------------------------------------------
const routes = app
  // ------------------------------------------------------------- health
  .get("/api/health", async (c) => {
    let dbStatus = "connected";
    try {
      await db.execute(sql`select 1`);
    } catch (error) {
      dbStatus = "disconnected";
      captureException(error, { endpoint: "/api/health" });
    }
    return c.json({
      ok: true,
      service: "regateoapp-api",
      timestamp: new Date().toISOString(),
      db: dbStatus,
      cache: cacheBackend,
    });
  })

  // ------------------------------------------------------------- security/captcha
  .get(
    "/api/security/captcha",
    rateLimitMiddleware({ limit: 30, windowSec: 60, bucket: "captcha" }),
    async (c) => {
      const config = getCaptchaPublicConfig();
      if (config.provider === "turnstile") {
        return c.json({ provider: "turnstile", siteKey: config.siteKey, challenge: null });
      }
      const challenge = createBuiltinChallenge();
      return c.json({
        provider: "builtin",
        siteKey: config.siteKey,
        challenge: {
          challengeId: challenge.challengeId,
          question: challenge.question,
          token: challenge.token,
          expiresAt: challenge.expiresAt,
        },
      });
    }
  )

  // ------------------------------------------------------------- auth
  // Endpoints de credenciales protegidos contra bots (rate limit + captcha).
  // El resto de /api/auth/* (get-session, sign-out, forgot-password, etc.)
  // sigue abierto a través del catch-all de abajo.
  .post(
    "/api/auth/sign-up/email",
    rateLimitMiddleware({ limit: 12, windowSec: 60, bucket: "auth-write" }),
    requireCaptchaMiddleware,
    (c) => authHandler(c.req.raw)
  )
  .post(
    "/api/auth/sign-in/email",
    rateLimitMiddleware({ limit: 12, windowSec: 60, bucket: "auth-write" }),
    requireCaptchaMiddleware,
    (c) => authHandler(c.req.raw)
  )
  .all("/api/auth/*", (c) => authHandler(c.req.raw))

  // ------------------------------------------------------------- products
  .get(
    "/api/products",
    zValidator("query", productSearchQuerySchema, validationHook),
    async (c) => {
      const query: ProductSearchQuery = c.req.valid("query");
      const cacheKey = `products:list:${JSON.stringify(query)}`;
      const { value, cached } = await cacheGetOrSet(cacheKey, 60, async () => {
        const result = await searchProducts(query);
        const lastScrapedAt = await getLastScrapedAt();
        return {
          items: result.items,
          pagination: result.pagination,
          facets: result.facets,
          meta: {
            cached: false,
            lastScrapedAt,
            // Productos con 2+ tiendas en stock (comparables reales)
            comparableCount: result.comparableCount,
          },
        };
      });
      return c.json({
        items: value.items,
        pagination: value.pagination,
        facets: value.facets,
        meta: { ...value.meta, cached },
      });
    }
  )

  // ------------------------------------------------------------- deals
  .get(
    "/api/products/deals",
    zValidator("query", dealsQuerySchema, validationHook),
    async (c) => {
      const { limit } = c.req.valid("query");
      const { value, cached } = await cacheGetOrSet(
        `products:deals:${limit}`,
        60,
        async () => ({ items: await getBestDeals(limit) })
      );
      return c.json({ items: value.items, meta: { cached } });
    }
  )

  // ------------------------------------------------------------- similares
  .get(
    "/api/products/:slug/similar",
    zValidator("query", similarQuerySchema, validationHook),
    async (c) => {
      const slug = c.req.param("slug");
      const { limit } = c.req.valid("query");
      const { value, cached } = await cacheGetOrSet(
        `catalog:similar:${slug}:${limit}`,
        60,
        async () => {
          const result = await getSimilarProductsForSlug(slug, limit);
          return { found: result !== null, result };
        }
      );
      if (!value.found) {
        return c.json(
          { error: "not_found", message: `Producto no encontrado: ${slug}` },
          404
        );
      }
      return c.json({ ...value.result, meta: { cached } });
    }
  )

  // ------------------------------------------------------------- detalle
  .get("/api/products/:slug", async (c) => {
    const slug = c.req.param("slug");
    const { value, cached } = await cacheGetOrSet(
      `products:detail:${slug}`,
      60,
      async () => ({ product: await getProductBySlug(slug) })
    );
    if (!value.product) {
      return c.json(
        { error: "not_found", message: `Producto no encontrado: ${slug}` },
        404
      );
    }
    return c.json({ product: value.product, meta: { cached } });
  })

  // ------------------------------------------------------------- stores
  .get("/api/stores", async (c) => {
    const { value, cached } = await cacheGetOrSet(
      "products:stores",
      15,
      async () => getStoresStatus()
    );
    return c.json({
      stores: value.stores,
      recentRuns: value.recentRuns,
      meta: { cached },
    });
  })

  // ------------------------------------------------------------- alerts
  // Doble opt-in (auditoría #4): autenticado con su mismo correo → verificado;
  // invitado → confirmToken + correo de confirmación (Resend si está activo).
  .post(
    "/api/alerts",
    rateLimitMiddleware({ limit: 10, windowSec: 60, bucket: "alerts" }),
    requireCaptchaMiddleware,
    zValidator("json", createPriceAlertSchema, validationHook),
    async (c) => {
      const input = c.req.valid("json");
      if (!(await productExistsById(input.productId))) {
        return c.json(
          {
            error: "not_found",
            message: "El producto indicado no existe en el catálogo.",
          },
          404
        );
      }
      const session = await getSessionUser(c.req.raw.headers);
      const sessionUser = session?.user;
      const sameEmailAsSession =
        sessionUser &&
        sessionUser.email.toLowerCase() === input.email.toLowerCase();

      if (sameEmailAsSession) {
        // Usuario autenticado con ese mismo correo: alerta verificada de una vez
        const alert = await createPriceAlert(
          input,
          sessionUser.id,
          { verified: true, confirmedAt: new Date() }
        );
        if (!alert) {
          return c.json(
            { error: "create_failed", message: "No se pudo crear la alerta." },
            500
          );
        }
        return c.json({ alert }, 201);
      }

      // Invitado: doble opt-in con token de confirmación único
      const confirmToken = crypto.randomUUID();
      const alert = await createPriceAlert(input, sessionUser?.id ?? null, {
        verified: false,
        confirmToken,
      });
      if (!alert) {
        return c.json(
          { error: "create_failed", message: "No se pudo crear la alerta." },
          500
        );
      }

      const origin = new URL(c.req.url).origin;
      const confirmUrl = `${origin}/api/alerts/confirm?token=${confirmToken}`;
      void sendAlertConfirmationEmail(input.email, confirmUrl, alert.product.canonicalName);

      return c.json(
        {
          alert,
          requiresConfirmation: true,
          confirmUrl: isProduction ? undefined : confirmUrl,
        },
        201
      );
    }
  )

  // Cierre de fuga Ley 81 (auditoría #3): NUNCA listado público por email.
  .get(
    "/api/alerts",
    requireUser,
    rateLimitMiddleware({ limit: 60, windowSec: 60, bucket: "alerts-list" }),
    async (c) => {
      const alerts = await listUserAlerts(c.get("meUser"));
      return c.json({ alerts });
    }
  )

  .get(
    "/api/alerts/confirm",
    rateLimitMiddleware({ limit: 10, windowSec: 60, bucket: "alerts-confirm" }),
    async (c) => {
      const token = c.req.query("token")?.trim();
      let confirmed = false;
      if (token) {
        const rows = await db
          .update(priceAlerts)
          .set({
            verified: true,
            confirmedAt: new Date(),
            // El token se consume: reutilizar el enlace → 404
            confirmToken: null,
          })
          .where(eq(priceAlerts.confirmToken, token))
          .returning({ id: priceAlerts.id });
        confirmed = rows.length > 0;
      }
      const html = confirmed
        ? `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Alerta confirmada — RegateoApp</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}div{text-align:center;max-width:480px;padding:2rem}h1{font-size:1.4rem}a{color:#e11d48}</style></head><body><div><h1>¡Alerta confirmada! 🔔</h1><p>Te avisaremos por correo cuando el precio baje al nivel que elegiste.</p><p><a href="${webUrl}">Volver a RegateoApp</a></p></div></body></html>`
        : `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Enlace inválido — RegateoApp</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}div{text-align:center;max-width:480px;padding:2rem}a{color:#e11d48}</style></head><body><div><h1>Enlace de confirmación inválido</h1><p>El enlace no existe o ya fue utilizado.</p><p><a href="${webUrl}">Volver a RegateoApp</a></p></div></body></html>`;
      return c.body(html, confirmed ? 200 : 404, {
        "content-type": "text/html; charset=UTF-8",
      });
    }
  )

  // ------------------------------------------------------------- reports
  .post(
    "/api/reports",
    rateLimitMiddleware({ limit: 10, windowSec: 60, bucket: "reports" }),
    zValidator("json", reportWrongPriceSchema, validationHook),
    async (c) => {
      const input = c.req.valid("json");
      const [listing] = await db
        .select({ id: storeListings.id })
        .from(storeListings)
        .where(
          and(
            eq(storeListings.id, input.listingId),
            eq(storeListings.productId, input.productId)
          )
        )
        .limit(1);
      if (!listing) {
        return c.json(
          {
            error: "not_found",
            message: "El listado indicado no existe para ese producto.",
          },
          404
        );
      }
      const [report] = await db
        .insert(priceReports)
        .values({
          productId: input.productId,
          listingId: input.listingId,
          reason: input.reason,
          details: input.details ?? null,
        })
        .returning({ id: priceReports.id });
      return c.json({ ok: true, id: report.id }, 201);
    }
  )

  // ------------------------------------------------------------- Mi Espacio (auth)
  .get("/api/me/overview", requireUser, async (c) => {
    const me = c.get("meUser");
    return c.json(await getUserOverview(me));
  })

  .post(
    "/api/me/favorites",
    requireUser,
    rateLimitMiddleware({ limit: 60, windowSec: 60, bucket: "me-favorites" }),
    zValidator("json", createFavoriteSchema, validationHook),
    async (c) => {
      const favorite = await addUserFavorite(c.get("meUser").id, c.req.valid("json"));
      if (!favorite) {
        return c.json(
          { error: "not_found", message: "El producto indicado no existe en el catálogo." },
          404
        );
      }
      return c.json({ favorite }, 201);
    }
  )

  .delete("/api/me/favorites/:productId", requireUser, async (c) => {
    const removed = await removeUserFavorite(
      c.get("meUser").id,
      c.req.param("productId")
    );
    if (!removed) {
      return c.json(
        { error: "not_found", message: "Ese producto no está en tus favoritos." },
        404
      );
    }
    return c.json({ ok: true });
  })

  .post(
    "/api/me/favorites/sync",
    requireUser,
    rateLimitMiddleware({ limit: 30, windowSec: 60, bucket: "me-favorites-sync" }),
    zValidator("json", syncFavoritesSchema, validationHook),
    async (c) => {
      const result = await syncUserFavorites(c.get("meUser").id, c.req.valid("json"));
      return c.json({ ok: true, added: result.added, skipped: result.skipped });
    }
  )

  .post(
    "/api/me/lists",
    requireUser,
    rateLimitMiddleware({ limit: 30, windowSec: 60, bucket: "me-lists" }),
    zValidator("json", createShoppingListSchema, validationHook),
    async (c) => {
      const list = await createUserList(c.get("meUser").id, c.req.valid("json"));
      return c.json({ list }, 201);
    }
  )

  .delete("/api/me/lists/:listId", requireUser, async (c) => {
    const removed = await deleteUserList(c.get("meUser").id, c.req.param("listId"));
    if (!removed) {
      return c.json(
        { error: "not_found", message: "Lista no encontrada o no es tuya." },
        404
      );
    }
    return c.json({ ok: true });
  })

  .post(
    "/api/me/lists/:listId/items",
    requireUser,
    rateLimitMiddleware({ limit: 60, windowSec: 60, bucket: "me-list-items" }),
    zValidator("json", addListItemSchema, validationHook),
    async (c) => {
      const item = await addItemToUserList(
        c.get("meUser").id,
        c.req.param("listId"),
        c.req.valid("json")
      );
      if (!item) {
        return c.json(
          {
            error: "not_found",
            message: "Lista o producto no encontrados, o la lista no es tuya.",
          },
          404
        );
      }
      return c.json({ item }, 201);
    }
  )

  .delete("/api/me/lists/:listId/items/:productId", requireUser, async (c) => {
    const removed = await removeItemFromUserList(
      c.get("meUser").id,
      c.req.param("listId"),
      c.req.param("productId")
    );
    if (!removed) {
      return c.json(
        { error: "not_found", message: "Ítem no encontrado en esa lista." },
        404
      );
    }
    return c.json({ ok: true });
  })

  .patch(
    "/api/me/alerts/:alertId",
    requireUser,
    zValidator("json", updateAlertSchema, validationHook),
    async (c) => {
      const alert = await updateUserAlert(
        c.get("meUser"),
        c.req.param("alertId"),
        c.req.valid("json")
      );
      if (!alert) {
        return c.json(
          { error: "not_found", message: "Alerta no encontrada o no es tuya." },
          404
        );
      }
      return c.json({ alert });
    }
  )

  .delete("/api/me/alerts/:alertId", requireUser, async (c) => {
    const removed = await deleteUserAlert(
      c.get("meUser"),
      c.req.param("alertId")
    );
    if (!removed) {
      return c.json(
        { error: "not_found", message: "Alerta no encontrada o no es tuya." },
        404
      );
    }
    return c.json({ ok: true });
  })

  // ------------------------------------------------------------- ai chat
  .post(
    "/api/ai/chat",
    rateLimitMiddleware({ limit: 20, windowSec: 60, bucket: "ai-chat" }),
    // Cuota diaria adicional (auditoría #8): 40 mensajes/día por IP
    rateLimitMiddleware({ limit: 40, windowSec: 86_400, bucket: "ai-chat-daily" }),
    zValidator("json", aiChatRequestSchema, validationHook),
    (c) => aiChatHandler(c.req.valid("json"))
  )

  // ------------------------------------------------------------- cron scrape
  .post(
    "/api/cron/scrape",
    zValidator("query", triggerScrapeQuerySchema, validationHook),
    async (c) => {
      const cronSecret = process.env.CRON_SECRET;
      const headerSecret = c.req.header("x-cron-secret");
      const authorization = c.req.header("authorization");
      const bearer = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;

      // Siempre protegido con CRON_SECRET — nunca expuesto a usuarios públicos
      const authorized = Boolean(
        cronSecret && (headerSecret === cronSecret || bearer === cronSecret)
      );
      if (!authorized) {
        return c.json(
          { error: "unauthorized", message: "Acceso restringido a automatización interna (CRON_SECRET)." },
          401
        );
      }

      const rawBody = await c.req.json().catch(() => ({}));
      const wait = c.req.valid("query")?.wait ?? false;

      // Import dinámico seguro: el scraper puede estar desplegándose aparte.
      interface ScrapeSummary {
        runId: string;
        storeSlug: string;
        engine: string;
        status: "completed" | "failed";
        itemsFound: number;
        itemsUpserted: number;
        errorMessage?: string;
      }
      interface ScraperModule {
        runScrapePipeline(options?: {
          stores?: string[];
          maxPerStore?: number;
          useFirecrawl?: boolean;
        }): Promise<ScrapeSummary[]>;
      }

      const specifier: string = "@regateo/scraper";
      const scraperModule = (await import(specifier).catch(() => null)) as
        | ScraperModule
        | null;

      if (!scraperModule || typeof scraperModule.runScrapePipeline !== "function") {
        return c.json(
          {
            ok: false,
            error: "scraper_unavailable",
            message:
              "El módulo @regateo/scraper todavía no está disponible. Intenta cuando el pipeline de scraping esté listo.",
          },
          503
        );
      }

      // Opciones del scrape validadas con el contrato de @regateo/shared:
      // maxPerStore hasta 20,000 (default 5,000), stores y useFirecrawl.
      const scrapeOptions = triggerScrapeSchema.safeParse(rawBody ?? {});
      if (!scrapeOptions.success) {
        return c.json(
          {
            error: "validation_error",
            message: "Opciones de scrape inválidas (maxPerStore debe ser un entero entre 1 y 20000).",
            details: scrapeOptions.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          400
        );
      }
      const options = scrapeOptions.data;

      const runPipeline = async (): Promise<ScrapeSummary[]> => {
        const runs = await scraperModule.runScrapePipeline(options);
        await cacheInvalidatePrefix("products:");
        await cacheInvalidatePrefix("catalog:");
        return runs;
      };

      if (!wait) {
        // Fire-and-forget: el pipeline puede tardar minutos.
        void runPipeline()
          .then((runs) =>
            logger.info("cron_scrape_completed", {
              runs: runs.map((run) => ({
                store: run.storeSlug,
                status: run.status,
                items: run.itemsUpserted,
              })),
            })
          )
          .catch((error) =>
            captureException(error, { endpoint: "/api/cron/scrape" })
          );
        return c.json(
          { ok: true, started: true, message: "Scraping iniciado en segundo plano." },
          202
        );
      }

      try {
        const runs: ScrapeSummary[] = await runPipeline();
        const summaries: ScrapeRunDTO[] = runs.map((run) => ({
          id: run.runId,
          storeSlug: run.storeSlug,
          engine: run.engine,
          status: run.status,
          itemsFound: run.itemsFound,
          itemsUpserted: run.itemsUpserted,
          errorMessage: run.errorMessage ?? null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        }));
        return c.json({ ok: true, started: false, runs: summaries });
      } catch (error) {
        captureException(error, { endpoint: "/api/cron/scrape" });
        return c.json(
          {
            ok: false,
            error: "scrape_failed",
            message: error instanceof Error ? error.message : "Error desconocido",
          },
          500
        );
      }
    }
  )

  // ------------------------------------------------------------- cache flush interno (post-scrape CLI)
  .post("/api/cron/invalidate-cache", async (c) => {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = c.req.header("x-cron-secret");
    const authorization = c.req.header("authorization");
    const bearer = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!cronSecret || (headerSecret !== cronSecret && bearer !== cronSecret)) {
      return c.json(
        { error: "unauthorized", message: "Secreto de cron inválido." },
        401
      );
    }

    await cacheInvalidatePrefix("products:");
    await cacheInvalidatePrefix("catalog:");
    await cacheInvalidatePrefix("seo:");
    return c.json({ ok: true, invalidated: ["products:", "catalog:", "seo:"] });
  })

  // ------------------------------------------------------------- tracking de clics
  // Redirección medible hacia la tienda real: registra outbound_clicks
  // asíncronamente y devuelve 302 al URL canónico de la tienda.
  .get(
    "/out/:listingId",
    rateLimitMiddleware({ limit: 120, windowSec: 60, bucket: "out-clicks" }),
    async (c) => {
      const listingId = c.req.param("listingId");
      const [listing] = await db
        .select({
          id: storeListings.id,
          productId: storeListings.productId,
          storeId: storeListings.storeId,
          storeSlug: stores.slug,
          url: storeListings.url,
        })
        .from(storeListings)
        .innerJoin(stores, eq(stores.id, storeListings.storeId))
        .where(eq(storeListings.id, listingId))
        .limit(1);

      if (!listing) {
        return c.json(
          { error: "not_found", message: "Listado no encontrado." },
          404
        );
      }
      if (!/^https?:\/\//i.test(listing.url)) {
        return c.json(
          { error: "invalid_url", message: "El listado no tiene un URL válido." },
          422
        );
      }

      const source = (c.req.query("src") ?? "card").slice(0, 32);
      void db
        .insert(outboundClicks)
        .values({
          listingId: listing.id,
          productId: listing.productId,
          storeId: listing.storeId,
          storeSlug: listing.storeSlug,
          source,
        })
        .catch(() => {
          // la medición jamás bloquea la redirección
        });

      return c.redirect(listing.url, 302);
    }
  )

  // ------------------------------------------------------------- SEO
  .get("/robots.txt", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.body(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /out/\n\nSitemap: ${origin}/sitemap.xml\n`,
      200,
      { "content-type": "text/plain; charset=UTF-8" }
    );
  })

  .get("/sitemap.xml", async (c) => {
    const origin = new URL(c.req.url).origin;
    const { value } = await cacheGetOrSet("seo:sitemap", 3600, async () => {
      const [productRows, categoryRows] = await Promise.all([
        db
          .select({ slug: products.slug, updatedAt: products.updatedAt })
          .from(products)
          .orderBy(desc(products.updatedAt))
          .limit(1000),
        db
          .select({ key: products.category })
          .from(products)
          .groupBy(products.category),
      ]);

      const urls: string[] = [];
      for (const row of categoryRows) {
        urls.push(
          `  <url><loc>${webUrl}/?categoria=${row.key}</loc><changefreq>daily</changefreq></url>`
        );
      }
      for (const row of productRows) {
        const lastmod = (row.updatedAt instanceof Date
          ? row.updatedAt
          : new Date(row.updatedAt)
        )
          .toISOString()
          .slice(0, 10);
        urls.push(
          `  <url><loc>${origin}/p/${row.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq></url>`
        );
      }
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
    });
    return c.body(value, 200, { "content-type": "application/xml; charset=UTF-8" });
  })

  // Ficha SEO liviana con JSON-LD Product + AggregateOffer para WhatsApp/OG
  .get("/p/:slug", async (c) => {
    const slug = c.req.param("slug");
    const { value } = await cacheGetOrSet(`seo:p:${slug}`, 300, async () => ({
      product: await getProductBySlug(slug),
    }));
    const product = value.product;

    if (!product) {
      return c.body(
        "<!DOCTYPE html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Producto no encontrado — RegateoApp</title></head><body><h1>Producto no encontrado</h1><p><a href=\"" +
          webUrl +
          "\">Ir a RegateoApp</a></p></body></html>",
        404,
        { "content-type": "text/html; charset=UTF-8" }
      );
    }

    const escapeHtml = (text: string): string =>
      text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const origin = new URL(c.req.url).origin;
    const spaUrl = `${webUrl}/?producto=${encodeURIComponent(slug)}`;
    const bestUsd = formatUsdFromCents(product.bestPriceCents);
    const savingsUsd =
      product.savingsCents > 0 ? formatUsdFromCents(product.savingsCents) : null;
    const title = `${product.canonicalName} desde ${bestUsd} | RegateoApp`;
    const description =
      `Compara precios de ${product.canonicalName} en ${product.storeCount} tienda${
        product.storeCount === 1 ? "" : "s"
      } de Panamá${savingsUsd ? ` y ahorra hasta ${savingsUsd}` : ""}. El mejor precio hoy: ${bestUsd} en ${
        product.bestStore?.name ?? "la tienda con mejor precio"
      }.`;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.canonicalName,
      ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
      ...(product.imageUrl ? { image: product.imageUrl } : {}),
      description,
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: product.bestPriceCents / 100,
        highPrice: product.highestPriceCents / 100,
        offerCount: product.storeCount,
        offers: product.listings.map((listing) => ({
          "@type": "Offer",
          price: listing.priceCents / 100,
          priceCurrency: "USD",
          availability: listing.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url: listing.url,
          seller: { "@type": "Organization", name: listing.storeName },
        })),
      },
    };

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${origin}/p/${slug}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="RegateoApp">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(product.imageUrl ?? "")}">
<meta property="og:url" content="${origin}/p/${slug}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main style="font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem">
<h1>${escapeHtml(product.canonicalName)}</h1>
<p>Mejor precio hoy: <strong style="font-variant-numeric:tabular-nums">${bestUsd}</strong> en ${escapeHtml(
      product.bestStore?.name ?? "la tienda con mejor precio"
    )}${savingsUsd ? ` — ahorra hasta ${savingsUsd} comparando tiendas` : ""}.</p>
<p><a href="${spaUrl}" style="color:#e11d48">Ver comparación completa de precios en RegateoApp</a></p>
</main>
<script>setTimeout(function(){window.location.replace(decodeURIComponent(encodeURIComponent("${spaUrl.replace(/"/g, "%22")}")));},1500);</script>
</body>
</html>`;

    return c.body(html, 200, { "content-type": "text/html; charset=UTF-8" });
  });

export type AppType = typeof routes;
export { app, routes };
export default app;
