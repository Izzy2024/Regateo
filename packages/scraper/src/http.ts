/**
 * Small, dependency-free HTTP helper shared by every adapter and by the
 * Firecrawl fallback chain. Panamanian retail sites are frequently slow and
 * occasionally throttle, so every request is time-boxed and retried with
 * exponential backoff.
 */

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "es-PA,es;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** HTTP statuses that must not be retried (defaults to 4xx except 408/429). */
  stopOnStatus?: number[];
  /** External cancellation (pipeline store timeout). */
  signal?: AbortSignal;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 25_000, retries = 2, headers, stopOnStatus, signal } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new Error(`Solicitud cancelada: ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        headers: { ...BROWSER_HEADERS, ...headers },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable =
          response.status >= 500 || response.status === 408 || response.status === 429;
        const explicitlyStopped = stopOnStatus?.includes(response.status) ?? false;
        const error = new HttpError(`${url} respondió HTTP ${response.status}`, response.status);
        if (explicitlyStopped || (!retryable && response.status < 500)) throw error;
        lastError = error;
      } else {
        return await response.text();
      }
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        if (error.status !== 408 && error.status !== 429) throw error;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    if (attempt < retries) await sleep(600 * (attempt + 1) ** 2);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const body = await fetchText(url, {
    ...options,
    headers: { Accept: "application/json,text/plain,*/*", ...options.headers },
  });
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Respuesta no-JSON desde ${url} (primeros 120 chars: ${body.slice(0, 120)})`);
  }
}

export async function postJson<T>(
  url: string,
  payload: unknown,
  options: FetchOptions = {}
): Promise<T> {
  const { timeoutMs = 30_000, retries = 1, headers, signal } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new Error(`Solicitud cancelada: ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...BROWSER_HEADERS,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new HttpError(`${url} respondió HTTP ${response.status}`, response.status);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        if (error.status !== 408 && error.status !== 429) throw error;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (attempt < retries) await sleep(700 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Runs `tasks` with a bounded concurrency, preserving result order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index] as T, index);
      }
    })
  );

  return results;
}
