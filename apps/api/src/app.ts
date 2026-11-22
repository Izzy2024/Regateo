// ============================================================================
// @regateo/api — Hono app con todas las rutas encadenadas (RPC AppType).
// ============================================================================
import { Hono } from "hono";
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
  productSearchQuerySchema,
  syncFavoritesSchema,
  triggerScrapeSchema,
  updateAlertSchema,
  type ProductSearchQuery,
} from "@regateo/shared";
import { db, sql } from "@regateo/db";
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
  listAlertsByEmail,
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
  removeItemFromUserList,
  removeUserFavorite,
  syncUserFavorites,
  updateUserAlert,
} from "./services/user-space";

const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// App base: CORS + logging + errores
// ---------------------------------------------------------------------------
const app = new Hono();

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

const alertsQuerySchema = z.object({
  email: z.string().email("email es requerido y debe ser un correo válido"),
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
          meta: { cached: false, lastScrapedAt },
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
      const alert = await createPriceAlert(input, session?.user?.id ?? null);
      if (!alert) {
        return c.json(
          { error: "create_failed", message: "No se pudo crear la alerta." },
          500
        );
      }
      return c.json({ alert }, 201);
    }
  )
  .get(
    "/api/alerts",
    zValidator("query", alertsQuerySchema, validationHook),
    rateLimitMiddleware({ limit: 60, windowSec: 60, bucket: "alerts-list" }),
    async (c) => {
      const { email } = c.req.valid("query");
      const alerts = await listAlertsByEmail(email);
      return c.json({ alerts });
    }
  )

  // ------------------------------------------------------------- Mi Espacio (auth)
  .get("/api/me/overview", async (c) => {
    const session = await getSessionUser(c.req.raw.headers);
    if (!session?.user) {
      return c.json(
        { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
        401
      );
    }
    const overview = await getUserOverview({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    });
    return c.json(overview);
  })

  .post(
    "/api/me/favorites",
    rateLimitMiddleware({ limit: 60, windowSec: 60, bucket: "me-favorites" }),
    zValidator("json", createFavoriteSchema, validationHook),
    async (c) => {
      const session = await getSessionUser(c.req.raw.headers);
      if (!session?.user) {
        return c.json(
          { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
          401
        );
      }
      const favorite = await addUserFavorite(
        session.user.id,
        c.req.valid("json")
      );
      if (!favorite) {
        return c.json(
          { error: "not_found", message: "El producto indicado no existe en el catálogo." },
          404
        );
      }
      return c.json({ favorite }, 201);
    }
  )

  .delete("/api/me/favorites/:productId", async (c) => {
    const session = await getSessionUser(c.req.raw.headers);
    if (!session?.user) {
      return c.json(
        { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
        401
      );
    }
    const removed = await removeUserFavorite(
      session.user.id,
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
    rateLimitMiddleware({ limit: 30, windowSec: 60, bucket: "me-favorites-sync" }),
    zValidator("json", syncFavoritesSchema, validationHook),
    async (c) => {
      const session = await getSessionUser(c.req.raw.headers);
      if (!session?.user) {
        return c.json(
          { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
          401
        );
      }
      const result = await syncUserFavorites(
        session.user.id,
        c.req.valid("json")
      );
      return c.json({ ok: true, added: result.added, skipped: result.skipped });
    }
  )

  .post(
    "/api/me/lists",
    rateLimitMiddleware({ limit: 30, windowSec: 60, bucket: "me-lists" }),
    zValidator("json", createShoppingListSchema, validationHook),
    async (c) => {
      const session = await getSessionUser(c.req.raw.headers);
      if (!session?.user) {
        return c.json(
          { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
          401
        );
      }
      const list = await createUserList(session.user.id, c.req.valid("json"));
      return c.json({ list }, 201);
    }
  )

  .delete("/api/me/lists/:listId", async (c) => {
    const session = await getSessionUser(c.req.raw.headers);
    if (!session?.user) {
      return c.json(
        { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
        401
      );
    }
    const removed = await deleteUserList(session.user.id, c.req.param("listId"));
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
    rateLimitMiddleware({ limit: 60, windowSec: 60, bucket: "me-list-items" }),
    zValidator("json", addListItemSchema, validationHook),
    async (c) => {
      const session = await getSessionUser(c.req.raw.headers);
      if (!session?.user) {
        return c.json(
          { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
          401
        );
      }
      const item = await addItemToUserList(
        session.user.id,
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

  .delete("/api/me/lists/:listId/items/:productId", async (c) => {
    const session = await getSessionUser(c.req.raw.headers);
    if (!session?.user) {
      return c.json(
        { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
        401
      );
    }
    const removed = await removeItemFromUserList(
      session.user.id,
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
    zValidator("json", updateAlertSchema, validationHook),
    async (c) => {
      const session = await getSessionUser(c.req.raw.headers);
      if (!session?.user) {
        return c.json(
          { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
          401
        );
      }
      const alert = await updateUserAlert(
        {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null,
        },
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

  .delete("/api/me/alerts/:alertId", async (c) => {
    const session = await getSessionUser(c.req.raw.headers);
    if (!session?.user) {
      return c.json(
        { error: "unauthorized", message: "Inicia sesión para acceder a Mi Espacio." },
        401
      );
    }
    const removed = await deleteUserAlert(
      {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
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
              "El módulo @regateo/scraper todavía no está disponible. Intentá cuando el pipeline de scraping esté listo.",
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
    return c.json({ ok: true, invalidated: ["products:", "catalog:"] });
  });

export type AppType = typeof routes;
export { app, routes };
export default app;
