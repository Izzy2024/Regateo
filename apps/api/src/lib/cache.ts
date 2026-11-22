// ============================================================================
// Caché distribuida (Upstash Redis) con fallback automático en memoria.
// En desarrollo local sin UPSTASH_* configuradas, todo funciona igualmente.
// ============================================================================
import type { MiddlewareHandler } from "hono";
import { Ratelimit, type Ratelimit as RatelimitType } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const cacheBackend: "upstash" | "memory" =
  upstashUrl && upstashToken ? "upstash" : "memory";

const redis =
  cacheBackend === "upstash"
    ? new Redis({ url: upstashUrl as string, token: upstashToken as string })
    : null;

// ---------------------------------------------------------------------------
// Fallback en memoria con TTL perezoso (suficiente para un solo proceso dev)
// ---------------------------------------------------------------------------
interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();
const memoryRateBuckets = new Map<string, number[]>();

function memoryGet(key: string): unknown | undefined {
  const entry = memoryStore.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return undefined;
  }
  return entry.value;
}

function memorySet(key: string, value: unknown, ttlSec: number): void {
  if (memoryStore.size > 5_000) {
    // Evitar crecimiento sin límite: purgar entradas expiradas.
    const now = Date.now();
    for (const [k, v] of memoryStore) {
      if (v.expiresAt < now) memoryStore.delete(k);
    }
  }
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

// ---------------------------------------------------------------------------
// Helpers públicos
// ---------------------------------------------------------------------------
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (cacheBackend === "upstash" && redis) {
      const raw = await redis.get<string>(key);
      if (raw === null || raw === undefined) return null;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
    }
    const hit = memoryGet(key);
    return hit === undefined ? null : (hit as T);
  } catch {
    // Una caché fallida nunca debe romper la respuesta.
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSec = 60
): Promise<void> {
  try {
    if (cacheBackend === "upstash" && redis) {
      await redis.set(key, JSON.stringify(value), { ex: ttlSec });
      return;
    }
    memorySet(key, value, ttlSec);
  } catch {
    // Ignorar fallos de escritura de caché.
  }
}

export async function cacheInvalidatePrefix(prefix: string): Promise<void> {
  try {
    if (cacheBackend === "upstash" && redis) {
      // SCAN iterativo con pipeline de borrado (patrones de claves acotados).
      let cursor = "0";
      do {
        const result = await redis.scan(cursor, { match: `${prefix}*`, count: 200 });
        const nextCursor = (result as unknown[])[0] as string;
        const keys = (result as unknown[])[1] as string[];
        if (keys.length > 0) await redis.del(...keys);
        cursor = nextCursor;
      } while (cursor !== "0" && cursor !== undefined && cursor !== null);
      return;
    }
    for (const key of memoryStore.keys()) {
      if (key.startsWith(prefix)) memoryStore.delete(key);
    }
  } catch {
    // Ignorar fallos de invalidación.
  }
}

/** Obtiene de caché o calcula y guarda. `meta.cached` en la respuesta. */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSec: number,
  compute: () => Promise<T>
): Promise<{ value: T; cached: boolean }> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return { value: hit, cached: true };
  const value = await compute();
  await cacheSet(key, value, ttlSec);
  return { value, cached: false };
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window por bucket). Instancias Upstash en caché por
// combinación `${bucket}:${limit}:${windowSec}` (antes: una sola fija 30/1m).
// ---------------------------------------------------------------------------
const ratelimitInstances = new Map<string, RatelimitType>();

function getRatelimit(limit: number, windowSec: number): RatelimitType | null {
  if (!redis) return null;
  const key = `${limit}:${windowSec}`;
  let instance = ratelimitInstances.get(key);
  if (!instance) {
    instance = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "regateoapp-rl",
    });
    ratelimitInstances.set(key, instance);
  }
  return instance;
}

/**
 * IP de confianza: cf-connecting-ip > x-real-ip; x-forwarded-for SOLO si
 * TRUST_PROXY=true (evita spoofing trivial del header en despliegues sin
 * proxy de confianza).
 */
export function clientIpFromHeaders(headers: {
  [key: string]: string | undefined;
}): string {
  const cdnIp = headers["cf-connecting-ip"]?.trim();
  if (cdnIp) return cdnIp;
  const realIp = headers["x-real-ip"]?.trim();
  if (realIp) return realIp;
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return "local";
}

export interface RateLimitOptions {
  /** Máximo de requests por ventana. */
  limit?: number;
  /** Ventana en segundos. */
  windowSec?: number;
  /** Prefijo por bucket de ruta (default: "global"). */
  bucket?: string;
}

export function rateLimitMiddleware(
  options: RateLimitOptions = {}
): MiddlewareHandler {
  const limit = options.limit ?? 30;
  const windowSec = options.windowSec ?? 60;
  const bucket = options.bucket ?? "global";
  const windowMs = windowSec * 1000;

  return async (c, next) => {
    const identifier = `${bucket}:${clientIpFromHeaders({
      "cf-connecting-ip": c.req.header("cf-connecting-ip") ?? undefined,
      "x-real-ip": c.req.header("x-real-ip") ?? undefined,
      "x-forwarded-for": c.req.header("x-forwarded-for") ?? undefined,
    })}`;
    try {
      const limiter = getRatelimit(limit, windowSec);
      if (limiter) {
        const { success } = await limiter.limit(identifier);
        if (!success) {
          return c.json(
            { error: "rate_limited", message: "Demasiadas solicitudes, prueba de nuevo en un momento." },
            429
          );
        }
      } else {
        const now = Date.now();
        const timestamps = (memoryRateBuckets.get(identifier) ?? []).filter(
          (ts) => now - ts < windowMs
        );
        if (timestamps.length >= limit) {
          return c.json(
            { error: "rate_limited", message: "Demasiadas solicitudes, esperá un momento." },
            429
          );
        }
        timestamps.push(now);
        memoryRateBuckets.set(identifier, timestamps);
      }
    } catch {
      // Rate limiting degradado nunca debe bloquear el request.
    }
    await next();
  };
}
