// ============================================================================
// POST /api/ai/chat — Asistente "Regateo AI".
// Streaming SSE (text/event-stream) con eventos tipados:
//   tool-call -> tool-result -> text-delta* -> done
// Con OPENROUTER_API_KEY usa Vercel AI SDK + Gateway OpenRouter.
// Sin API key, ejecuta las mismas tools reales contra PostgreSQL y transmite
// un flujo determinista e inteligente en español panameño.
// ============================================================================
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { PANAMA_STORES, type AiChatRequest } from "@regateo/shared";
import {
  toolCompareProductPrices,
  toolGetBestDeals,
  toolSearchProducts,
  type AiProductBrief,
} from "../services/catalog";
import { logger, trackLlmGeneration } from "../lib/observability";

// ---------------------------------------------------------------------------
// Tiendas monitoreadas: la lista se deriva de PANAMA_STORES para que el copy
// del prompt y de las tools nunca quede desactualizado al sumar una tienda.
// ---------------------------------------------------------------------------
const MONITORED_STORE_NAMES = PANAMA_STORES.filter((store) => store.enabled).map(
  (store) => store.name
);

/** "Multimax, Panafoto, …, y eVision Store" (13 tiendas activas en Panamá). */
const MONITORED_STORES_LABEL =
  MONITORED_STORE_NAMES.length > 1
    ? `${MONITORED_STORE_NAMES.slice(0, -1).join(", ")} y ${
        MONITORED_STORE_NAMES[MONITORED_STORE_NAMES.length - 1]
      }`
    : (MONITORED_STORE_NAMES[0] ?? "las tiendas de Panamá");

const MONITORED_STORES_COUNT = MONITORED_STORE_NAMES.length;

export interface LlmProviderConfig {
  provider: "neon-ai-gateway" | "deepseek" | "openrouter";
  apiKey: string;
  baseURL: string;
  model: string;
}

export function getNeonAiGatewayConfig() {
  const rawBase = process.env.NEON_AI_GATEWAY_BASE_URL?.trim() || null;
  const token = process.env.NEON_AI_GATEWAY_TOKEN?.trim() || null;
  const baseURL = rawBase ? `${rawBase.replace(/\/+$/, "")}/v1` : null;
  const model =
    process.env.NEON_AI_GATEWAY_MODEL?.trim() ||
    process.env.AI_MODEL?.trim() ||
    "openai/gpt-4o-mini";

  return {
    configured: Boolean(baseURL && token),
    baseURL,
    token,
    model,
  };
}

export async function fetchNeonAiGatewayStatus(): Promise<{
  configured: boolean;
  reachable: boolean;
  httpStatus: number | null;
  totalModels: number;
  enabledModels: number;
  requiresCredits: boolean;
  model: string;
}> {
  const cfg = getNeonAiGatewayConfig();
  if (!cfg.configured || !cfg.baseURL || !cfg.token) {
    return {
      configured: false,
      reachable: false,
      httpStatus: null,
      totalModels: 0,
      enabledModels: 0,
      requiresCredits: false,
      model: cfg.model,
    };
  }

  try {
    const res = await fetch(`${cfg.baseURL}/models`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        httpStatus: res.status,
        totalModels: 0,
        enabledModels: 0,
        requiresCredits: res.status === 402 || res.status === 403,
        model: cfg.model,
      };
    }
    const payload = (await res.json()) as {
      data?: Array<{ enabled?: boolean; unavailable_reason?: string }>;
    };
    const models = Array.isArray(payload.data) ? payload.data : [];
    const enabledCount = models.filter((m) => m.enabled !== false).length;
    const requiresCredits =
      models.length > 0 &&
      enabledCount === 0 &&
      models.some((m) => m.unavailable_reason === "paid_plan_required");
    return {
      configured: true,
      reachable: true,
      httpStatus: res.status,
      totalModels: models.length,
      enabledModels: enabledCount,
      requiresCredits,
      model: cfg.model,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      httpStatus: null,
      totalModels: 0,
      enabledModels: 0,
      requiresCredits: false,
      model: cfg.model,
    };
  }
}

function resolveLlmCandidates(): LlmProviderConfig[] {
  const candidates: LlmProviderConfig[] = [];
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();

  if (deepseekKey) {
    candidates.push({
      provider: "deepseek",
      apiKey: deepseekKey,
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1",
      model: process.env.AI_MODEL?.trim() || "deepseek-chat",
    });
  }
  if (openRouterKey) {
    candidates.push({
      provider: "openrouter",
      apiKey: openRouterKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      model: process.env.AI_MODEL?.trim() || "openai/gpt-4o-mini",
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Stream SSE
// ---------------------------------------------------------------------------
interface SseEventMap {
  "tool-call": {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    state: "loading";
    args: Record<string, unknown>;
  };
  "tool-result": {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    state: "result" | "error";
    result: unknown;
  };
  "text-delta": { type: "text-delta"; delta: string };
  error: { type: "error"; message: string };
  done: { type: "done" };
}

type SseEvent = SseEventMap[keyof SseEventMap];

function sseResponse(handle: (send: (event: SseEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };
      try {
        await handle(send);
      } catch (error) {
        logger.error("ai_chat_stream_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        send({
          type: "error",
          message: "Ocurrió un error procesando tu consulta. Intenta de nuevo.",
        });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // El cliente ya se desconectó.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

async function streamTextOut(
  send: (event: SseEvent) => void,
  text: string,
  delayMs = 18
): Promise<void> {
  // Chunks de ~4 palabras para una experiencia de streaming natural.
  const tokens = text.split(/(\s+)/).filter((token) => token.length > 0);
  let buffer = "";
  let wordCount = 0;
  const flush = () => {
    if (buffer.length > 0) {
      send({ type: "text-delta", delta: buffer });
      buffer = "";
      wordCount = 0;
    }
  };
  for (const token of tokens) {
    buffer += token;
    if (!/^\s+$/.test(token)) wordCount += 1;
    if (wordCount >= 4) flush();
    if (wordCount >= 4) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  flush();
}

// ---------------------------------------------------------------------------
// Tools reales contra PostgreSQL (compartidas por ambos modos)
// ---------------------------------------------------------------------------
function buildAiTools() {
  return {
    searchProducts: tool({
      description:
        "Busca productos de electrónica en el catálogo multi-tienda de Panamá por nombre, marca o modelo. Devuelve el mejor precio y la tienda más barata.",
      parameters: z.object({
        query: z.string().describe("Término de búsqueda: producto, marca o modelo"),
        category: z
          .enum([
            "computadoras",
            "celulares",
            "televisores",
            "linea-blanca",
            "audio",
            "perifericos",
            "gaming",
            "aires-acondicionados",
            "electrodomesticos",
            "accesorios",
          ])
          .optional()
          .describe("Categoría opcional para acotar la búsqueda"),
        limit: z.number().int().min(1).max(10).default(5).optional(),
      }),
      execute: async (args: { query: string; category?: string; limit?: number }) =>
        toolSearchProducts(args),
    }),
    compareProductPrices: tool({
      description: `Compara los precios actuales de un producto entre las ${MONITORED_STORES_COUNT} tiendas monitoreadas (${MONITORED_STORES_LABEL}). Recibe el nombre o el slug del producto.`,
      parameters: z.object({
        query: z.string().describe("Nombre o slug del producto a comparar"),
      }),
      execute: async (args: { query: string }) =>
        toolCompareProductPrices(args),
    }),
    getBestDeals: tool({
      description:
        "Devuelve las mejores ofertas activas: productos con mayor ahorro real entre tiendas o mayor descuento sobre su precio original.",
      parameters: z.object({
        limit: z.number().int().min(1).max(10).default(5).optional(),
      }),
      execute: async (args: { limit?: number }) => toolGetBestDeals(args),
    }),
  };
}

const SYSTEM_PROMPT = `Eres "Regateo AI", el asistente de compras de Regateo, el comparador de precios de electrónica de Panamá.
Reglas:
- Responde SIEMPRE en español panameño, breve, útil y con precios en USD ($).
- Usa las tools (searchProducts, compareProductPrices, getBestDeals) para dar datos reales de las ${MONITORED_STORES_COUNT} tiendas monitoreadas (${MONITORED_STORES_LABEL}). Nunca inventes precios.
- Recomienda la tienda más barata con su enlace directo para verificar el precio.
- Menciona el ahorro en USD cuando exista comparación entre tiendas.
- Sé directo: máximo 3 recomendaciones por respuesta.`;

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
export function aiChatHandler(body: AiChatRequest): Response {
  // Auditoría #8: recorta el historial a los últimos 8 mensajes (la API acepta
  // hasta 12) y nunca procesa rol "system" (lo garantiza aiChatRequestSchema).
  const messages = body.messages
    .map(({ id: _id, role, content }) => ({ role, content }))
    .slice(-8);
  const userText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const candidates = resolveLlmCandidates();

  if (candidates.length > 0) {
    return sseResponse(async (send) => {
      for (const llm of candidates) {
        const outcome = await streamWithAiSdk(send, messages, llm);
        if (outcome === "completed") return;
        // Si el proveedor falló antes de emitir texto/tools (p. ej. Neon AI Gateway sin créditos),
        // probamos el siguiente candidato o caemos al flujo determinista sin romper el chat.
      }
      await streamDeterministic(send, userText);
    });
  }

  // Modo desarrollo determinista: tools reales + streaming español útil.
  return sseResponse(async (send) => {
    await streamDeterministic(send, userText);
  });
}

// ---------------------------------------------------------------------------
// Camino 1: Vercel AI SDK vía Neon AI Gateway / DeepSeek / OpenRouter
// ---------------------------------------------------------------------------
async function streamWithAiSdk(
  send: (event: SseEvent) => void,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  llm: LlmProviderConfig
): Promise<"completed" | "fallback"> {
  const openai = createOpenAI({
    baseURL: llm.baseURL,
    apiKey: llm.apiKey,
    compatibility: "compatible",
  });

  const result = streamText({
    model: openai(llm.model),
    system: SYSTEM_PROMPT,
    messages,
    tools: buildAiTools(),
    maxSteps: 5,
    temperature: 0.4,
  });

  let fullText = "";
  let emittedOutput = false;
  let hadError = false;

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          emittedOutput = true;
          fullText += part.textDelta;
          send({ type: "text-delta", delta: part.textDelta });
          break;
        case "tool-call":
          emittedOutput = true;
          send({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            state: "loading",
            args: (part.args ?? {}) as Record<string, unknown>,
          });
          break;
        case "tool-result":
          emittedOutput = true;
          send({
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            state: "result",
            result: part.result,
          });
          break;
        case "error":
          hadError = true;
          logger.warn("ai_provider_stream_error", {
            provider: llm.provider,
            model: llm.model,
            emittedOutput,
            error: part.error instanceof Error ? part.error.message : String(part.error),
          });
          break;
        default:
          break;
      }
    }
  } catch (error) {
    hadError = true;
    logger.warn("ai_provider_exception", {
      provider: llm.provider,
      model: llm.model,
      emittedOutput,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (hadError && !emittedOutput) {
    return "fallback";
  }

  if (hadError && emittedOutput) {
    send({
      type: "error",
      message: `El modelo de IA (${llm.provider}) interrumpió la respuesta. Intenta de nuevo.`,
    });
  }

  trackLlmGeneration({
    name: `regateo-ai-chat-${llm.provider}`,
    model: llm.model,
    input: messages.at(-1)?.content ?? "",
    output: fullText,
  });

  send({ type: "done" });
  return "completed";
}

// ---------------------------------------------------------------------------
// Camino 2: determinista sin API key — tools reales + español panameño
// ---------------------------------------------------------------------------
const DEALS_PATTERN =
  /\b(oferta|ofertas|deal|deals|descuento|descuentos|rebaja|rebajas|m[áa]s barato|mas barato|barato|barata|ahorro|ahorrar|promoci[óo]n|promo)\b/i;
const COMPARE_PATTERN =
  /\b(compar[áa]|compara|comparar|comparaci[óo]n|entre tiendas|cu[áa]nto cuesta|cuanto cuesta|cu[áa]l es el mejor precio|mejor precio de)\b/i;

function cleanQuery(text: string): string {
  return text
    .replace(/[¿?¡!.]/g, " ")
    .replace(
      /\b(una?|el|la|los|las|de|del|por|para|en|que|mejor|precio|precios|precio de|dime|dame|deme|muéstrame|muestrame|enséñame|ensename|busca|buscar|buscame|búscame|encuentra|hola|gracias|cuanto|cuánto|cuesta|cu[áa]l|quiero|necesito|recomienda|recomiendame|comparaci[óo]n|comparame|compara|entre|tiendas?|tienda)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

export async function streamDeterministic(
  send: (event: SseEvent) => void,
  userText: string
): Promise<void> {
  const toolCallId = crypto.randomUUID();
  const query = cleanQuery(userText);
  let toolName = "searchProducts";
  let toolArgs: Record<string, unknown> = { query: query || userText, limit: 5 };

  if (DEALS_PATTERN.test(userText)) {
    toolName = "getBestDeals";
    toolArgs = { limit: 5 };
  } else if (COMPARE_PATTERN.test(userText)) {
    toolName = "compareProductPrices";
    toolArgs = { query: query || userText };
  }

  send({ type: "tool-call", toolCallId, toolName, state: "loading", args: toolArgs });

  let result: unknown;
  let narration: string;
  try {
    if (toolName === "getBestDeals") {
      result = await toolGetBestDeals(toolArgs as { limit?: number });
      narration = composeDeals(result as { items: AiProductBrief[] });
    } else if (toolName === "compareProductPrices") {
      result = await toolCompareProductPrices(toolArgs as { query: string });
      narration = composeCompare(
        result as Awaited<ReturnType<typeof toolCompareProductPrices>>
      );
    } else {
      result = await toolSearchProducts(toolArgs as { query?: string; limit?: number });
      narration = composeSearch(result as { total: number; items: AiProductBrief[] });
    }
    send({
      type: "tool-result",
      toolCallId,
      toolName,
      state: "result",
      result,
    });
  } catch (error) {
    send({
      type: "tool-result",
      toolCallId,
      toolName,
      state: "error",
      result: {
        message: error instanceof Error ? error.message : "Error consultando la base de datos",
      },
    });
    await streamTextOut(send, "Tuve un problema consultando el catálogo en este momento. Prueba de nuevo en un rato. 🙏");
    send({ type: "done" });
    return;
  }

  await streamTextOut(send, narration);
  send({ type: "done" });

  trackLlmGeneration({
    name: "regateo-ai-chat-deterministic",
    input: userText,
    output: narration,
  });
}

// ---------------------------------------------------------------------------
// Composición de respuestas deterministas (español panameño, datos reales)
// ---------------------------------------------------------------------------
function briefLine(item: AiProductBrief, index: number): string {
  const savings =
    item.storeCount > 1 && item.savings !== "$0.00"
      ? ` — ahorras ${item.savings} comprándolo ahí vs la tienda más cara`
      : "";
  const url = item.bestUrl ? `\n   Ver precio: ${item.bestUrl}` : "";
  return `${index + 1}. ${item.name} — desde ${item.bestPrice} en ${item.bestStore} (disponible en ${item.storeCount} tienda${item.storeCount === 1 ? "" : "s"})${savings}.${url}`;
}

function composeSearch(result: { total: number; items: AiProductBrief[] }): string {
  if (result.items.length === 0) {
    return "No encontré ese producto en las tiendas monitoreadas todavía. Puedes probar con otra palabra (por ejemplo: \"Smart TV 55\", \"Lavadora Samsung\" o \"Mouse Logitech\") o decirme la categoría y te muestro lo más barato de la semana. 🛒";
  }
  const intro =
    result.total > result.items.length
      ? `Esto fue lo que encontré (hay ${result.total} coincidencias, te muestro las mejores):`
      : "Esto fue lo que encontré:";
  const lines = result.items.map(briefLine).join("\n");
  const outro =
    "\nSi quieres, dime cuál te llama la atención y te comparo precios entre todas las tiendas, o créale una alerta de precio desde la ficha del producto. 💪";
  return `${intro}\n${lines}${outro}`;
}

function composeCompare(
  result: Awaited<ReturnType<typeof toolCompareProductPrices>>
): string {
  if (!result.found) {
    const suggestions = result.suggestions
      .map((item, index) => briefLine(item, index))
      .join("\n");
    return `${result.message} Pero mira, esto es lo más parecido que encontré:\n${suggestions}\nSi es alguno de estos, dime cuál y te armo la comparación completa entre tiendas.`;
  }
  const { product } = result;
  const lines = product.listings
    .map((listing, index) => {
      const stock = listing.inStock ? "en stock" : "agotado";
      const delta =
        index === 0
          ? "el mejor precio 🔥"
          : `+${listing.deltaFromBest} vs la más barata`;
      return `${index + 1}. ${listing.store}: ${listing.price} (${delta}, ${stock}) — ${listing.url}`;
    })
    .join("\n");
  const brand = product.brand ? ` de ${product.brand}` : "";
  return `Comparación real de "${product.name}"${brand} en las tiendas monitoreadas:\n${lines}\n\nMi recomendación: cómpralo en ${product.listings[0]?.store ?? "la tienda con mejor precio"} por ${product.bestPrice}. ${product.savings !== "$0.00" ? `Te ahorras ${product.savings} frente a la opción más cara. ` : ""}Los enlaces van directo al producto para que verifiques el precio antes de pagar. 😉`;
}

function composeDeals(result: { items: AiProductBrief[] }): string {
  if (result.items.length === 0) {
    return "Ahora mismo no tengo ofertas destacadas con ahorro comprobado entre tiendas. Vuelve a consultar en un par de días (actualizamos precios cada 3 días) o pídeme un producto específico y te busco el precio más bajo. 🤙";
  }
  const lines = result.items.map(briefLine).join("\n");
  return `Las mejores ofertas de electrónica en Panamá según nuestros datos más recientes:\n${lines}\nEstos precios se verifican contra las tiendas directamente, así que el enlace te lleva al producto real. ¿Quieres que te compare alguno entre todas las tiendas?`;
}
