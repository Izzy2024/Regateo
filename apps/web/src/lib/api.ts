import { hc } from "hono/client";
import type { AppType } from "@regateo/api/rpc";
import type {
  AiChatRequest,
  CreatePriceAlertInput,
  CreateShoppingListInput,
  FavoriteProductDTO,
  ProductCategory,
  ProductDetailDTO,
  ProductSearchQuery,
  ProductSummaryDTO,
  ReportWrongPriceInput,
  ShoppingListDTO,
  SimilarProductDTO,
  StoreStatusDTO,
  UpdateAlertInput,
  UserAlertDTO,
  UserOverviewDTO,
} from "@regateo/shared";

import { sanitizeExternalUrl } from "./utils";
export const API_BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001"
).replace(/\/+$/, "");

// End-to-end typed Hono RPC client bound to @regateo/api AppType
export const rpcClient = hc<AppType>(API_BASE_URL, {
  init: { credentials: "include" },
});

/**
 * Enlace saliente medible vía redirección del API (/out/:listingId?src=...).
 * Si falta el listingId, cae al URL directo de la tienda sanitizado.
 */
export function buildOutboundUrl(
  listingId: string | null | undefined,
  fallbackUrl: string | null | undefined,
  source: string
): string | null {
  if (listingId) {
    return `${API_BASE_URL}/out/${encodeURIComponent(listingId)}?src=${encodeURIComponent(source)}`;
  }
  return sanitizeExternalUrl(fallbackUrl);
}

export interface ProductsResponse {
  items: ProductSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  facets: {
    categories: Array<{ key: ProductCategory; count: number }>;
    brands: Array<{ name: string; count: number }>;
    stores: Array<{ slug: string; name: string; count: number }>;
  };
  meta: {
    cached: boolean;
    lastScrapedAt: string | null;
    comparableCount?: number;
  };
}

export interface CreatePriceAlertResponse {
  alert?: PriceAlertRecord;
  /** Doble opt-in: la alerta queda pendiente hasta confirmar por correo. */
  requiresConfirmation?: boolean;
  /** Solo presente en desarrollo para confirmar en 1 clic. */
  confirmUrl?: string;
}

export interface DealsResponse {
  items: ProductSummaryDTO[];
}

export interface ProductDetailResponse {
  product: ProductDetailDTO;
}

export interface SimilarProductsResponse {
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    bestPriceCents: number;
  };
  items: SimilarProductDTO[];
}

export interface ScrapeRunRecord {
  id: string;
  storeId?: string;
  storeSlug?: string;
  storeName?: string;
  engine: string;
  status: string;
  itemsFound: number;
  itemsUpserted: number;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface StoresResponse {
  stores: StoreStatusDTO[];
  recentRuns: ScrapeRunRecord[];
}

export interface PriceAlertRecord {
  id: string;
  productId: string;
  email: string;
  targetPriceCents: number;
  active?: boolean;
  createdAt?: string;
  productName?: string;
  productSlug?: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface AuthSessionResponse {
  user: AuthUser | null;
  session: { id: string; expiresAt?: string } | null;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  timestamp: string;
  db: string;
  cache: string;
}

export interface CaptchaHeaders {
  token: string;
  answer?: string;
  honeypot?: string;
}

export interface CaptchaChallenge {
  challengeId: string;
  question: string;
  token: string;
  expiresAt: string;
}

export interface CaptchaConfigResponse {
  provider: "turnstile" | "builtin";
  siteKey: string | null;
  challenge: CaptchaChallenge | null;
}

function buildCaptchaHeaders(captcha?: CaptchaHeaders): Record<string, string> {
  if (!captcha?.token) return {};
  const headers: Record<string, string> = {
    "x-captcha-token": captcha.token,
  };
  if (captcha.answer !== undefined && captcha.answer.trim() !== "") {
    headers["x-captcha-answer"] = captcha.answer.trim();
  }
  if (captcha.honeypot !== undefined && captcha.honeypot !== "") {
    headers["x-captcha-hp"] = captcha.honeypot;
  }
  return headers;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = `Error ${res.status} al conectar con el servidor`;
    let details: unknown;
    try {
      const payload = (await res.json()) as {
        error?: string;
        message?: string;
        details?: unknown;
      };
      message = payload.message || payload.error || message;
      details = payload.details;
    } catch {
      // fallback to status text
    }
    throw new ApiError(message, res.status, details);
  }

  return (await res.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

export function fetchCaptchaChallenge(): Promise<CaptchaConfigResponse> {
  return apiFetch<CaptchaConfigResponse>("/api/security/captcha");
}

export function fetchProducts(
  query: Partial<ProductSearchQuery>
): Promise<ProductsResponse> {
  const params = new URLSearchParams();
  if (query.q && query.q.trim()) params.set("q", query.q.trim());
  if (query.category) params.set("category", query.category);
  if (query.store) params.set("store", query.store);
  if (query.brand) params.set("brand", query.brand);
  if (query.minPrice !== undefined && query.minPrice > 0) {
    params.set("minPrice", String(query.minPrice));
  }
  if (query.maxPrice !== undefined && query.maxPrice > 0) {
    params.set("maxPrice", String(query.maxPrice));
  }
  if (query.inStockOnly) params.set("inStockOnly", "true");
  if (query.multiStoreOnly) params.set("multiStoreOnly", "true");
  if (query.sort) params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));

  const qs = params.toString();
  return apiFetch<ProductsResponse>(`/api/products${qs ? `?${qs}` : ""}`);
}

export function fetchDeals(): Promise<DealsResponse> {
  return apiFetch<DealsResponse>("/api/products/deals");
}

export function fetchProductBySlug(slug: string): Promise<ProductDetailResponse> {
  return apiFetch<ProductDetailResponse>(`/api/products/${encodeURIComponent(slug)}`);
}

export function fetchSimilarProducts(
  slug: string,
  limit = 8
): Promise<SimilarProductsResponse> {
  return apiFetch<SimilarProductsResponse>(
    `/api/products/${encodeURIComponent(slug)}/similar?limit=${limit}`
  );
}

export function fetchStores(): Promise<StoresResponse> {
  return apiFetch<StoresResponse>("/api/stores");
}

export function createPriceAlert(
  input: CreatePriceAlertInput,
  captcha?: CaptchaHeaders
): Promise<CreatePriceAlertResponse> {
  return apiFetch<CreatePriceAlertResponse>("/api/alerts", {
    method: "POST",
    headers: buildCaptchaHeaders(captcha),
    body: JSON.stringify(input),
  });
}

export function reportWrongPrice(
  input: ReportWrongPriceInput
): Promise<{ ok?: boolean }> {
  return apiFetch<{ ok?: boolean }>("/api/reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function triggerManualScrape(options?: {
  stores?: string[];
  maxPerStore?: number;
  useFirecrawl?: boolean;
}): Promise<{ ok?: boolean; runs?: ScrapeRunRecord[]; message?: string }> {
  return apiFetch<{ ok?: boolean; runs?: ScrapeRunRecord[]; message?: string }>(
    "/api/cron/scrape",
    {
      method: "POST",
      headers: {
        "x-manual-trigger": "true",
      },
      body: JSON.stringify(options ?? {}),
    }
  );
}

export async function getAuthSession(): Promise<AuthSessionResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/get-session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { user: null, session: null };
    const data = (await res.json()) as Partial<AuthSessionResponse> | null;
    if (!data || !data.user) return { user: null, session: null };
    return {
      user: data.user,
      session: data.session ?? null,
    };
  } catch {
    return { user: null, session: null };
  }
}

export async function signInWithEmail(
  input: {
    email: string;
    password: string;
  },
  captcha?: CaptchaHeaders
): Promise<{ user: AuthUser }> {
  return apiFetch<{ user: AuthUser }>("/api/auth/sign-in/email", {
    method: "POST",
    headers: buildCaptchaHeaders(captcha),
    body: JSON.stringify(input),
  });
}

export async function signUpWithEmail(
  input: {
    name: string;
    email: string;
    password: string;
  },
  captcha?: CaptchaHeaders
): Promise<{ user: AuthUser }> {
  return apiFetch<{ user: AuthUser }>("/api/auth/sign-up/email", {
    method: "POST",
    headers: buildCaptchaHeaders(captcha),
    body: JSON.stringify(input),
  });
}

export const authSignIn = signInWithEmail;
export const authSignUp = signUpWithEmail;

export async function signOutAuth(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/auth/sign-out`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

// ============================================================================
// Mi Espacio (Authenticated User API)
// ============================================================================

export function fetchUserOverview(): Promise<UserOverviewDTO> {
  return apiFetch<UserOverviewDTO>("/api/me/overview");
}

export function addFavoriteApi(
  productId: string,
  note?: string
): Promise<{ ok?: boolean; favorite?: FavoriteProductDTO }> {
  return apiFetch<{ ok?: boolean; favorite?: FavoriteProductDTO }>(
    "/api/me/favorites",
    {
      method: "POST",
      body: JSON.stringify(note ? { productId, note } : { productId }),
    }
  );
}

export function removeFavoriteApi(
  productId: string
): Promise<{ ok?: boolean }> {
  return apiFetch<{ ok?: boolean }>(
    `/api/me/favorites/${encodeURIComponent(productId)}`,
    {
      method: "DELETE",
    }
  );
}

export function syncFavoritesApi(
  productIds: string[]
): Promise<{ ok?: boolean; syncedCount?: number }> {
  return apiFetch<{ ok?: boolean; syncedCount?: number }>(
    "/api/me/favorites/sync",
    {
      method: "POST",
      body: JSON.stringify({ productIds }),
    }
  );
}

export function createShoppingListApi(
  input: CreateShoppingListInput
): Promise<{ ok?: boolean; list?: ShoppingListDTO }> {
  return apiFetch<{ ok?: boolean; list?: ShoppingListDTO }>("/api/me/lists", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteShoppingListApi(
  listId: string
): Promise<{ ok?: boolean }> {
  return apiFetch<{ ok?: boolean }>(
    `/api/me/lists/${encodeURIComponent(listId)}`,
    {
      method: "DELETE",
    }
  );
}

export function addListItemApi(
  listId: string,
  productId: string,
  quantity = 1
): Promise<{ ok?: boolean }> {
  return apiFetch<{ ok?: boolean }>(
    `/api/me/lists/${encodeURIComponent(listId)}/items`,
    {
      method: "POST",
      body: JSON.stringify({ productId, quantity }),
    }
  );
}

export function removeListItemApi(
  listId: string,
  productId: string
): Promise<{ ok?: boolean }> {
  return apiFetch<{ ok?: boolean }>(
    `/api/me/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(productId)}`,
    {
      method: "DELETE",
    }
  );
}

export function updateUserAlertApi(
  alertId: string,
  input: UpdateAlertInput
): Promise<{ ok?: boolean; alert?: UserAlertDTO }> {
  return apiFetch<{ ok?: boolean; alert?: UserAlertDTO }>(
    `/api/me/alerts/${encodeURIComponent(alertId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export function deleteUserAlertApi(alertId: string): Promise<{ ok?: boolean }> {
  return apiFetch<{ ok?: boolean }>(
    `/api/me/alerts/${encodeURIComponent(alertId)}`,
    {
      method: "DELETE",
    }
  );
}

export type AiStreamEvent =
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      state: "loading";
      args?: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      state: "result" | "error";
      result?: unknown;
      error?: string;
    }
  | {
      type: "text-delta";
      delta: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "done";
    };

export async function streamAiChat(
  request: AiChatRequest,
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    let message = `El asistente respondió con error (${response.status}).`;
    try {
      const json = (await response.json()) as { error?: string; message?: string };
      message = json.message || json.error || message;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(message, response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("El navegador no soporta lectura de stream SSE.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (rawLine: string) => {
    const trimmed = rawLine.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      onEvent({ type: "done" });
      return;
    }
    try {
      const parsed = JSON.parse(payload) as AiStreamEvent;
      onEvent(parsed);
    } catch {
      // Ignore malformed partial frame
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      processLine(line);
    }
  }

  if (buffer.trim()) {
    processLine(buffer);
  }
}
