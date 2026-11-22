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
import { type AiChatRequest } from "@regateo/shared";
import {
  toolCompareProductPrices,
  toolGetBestDeals,
  toolSearchProducts,
  type AiProductBrief,
} from "../services/catalog";
import { logger, trackLlmGeneration } from "../lib/observability";

function resolveLlmConfig() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();

  if (deepseekKey) {
    return {
      provider: "deepseek" as const,
      apiKey: deepseekKey,
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1",
      model: process.env.AI_MODEL?.trim() || "deepseek-chat",
    };
  }
  if (openRouterKey) {
    return {
      provider: "openrouter" as const,
      apiKey: openRouterKey,
      baseURL: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      model: process.env.AI_MODEL?.trim() || "openai/gpt-4o-mini",
    };
  }
  return null;
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
      description:
        "Compara los precios actuales de un producto entre todas las tiendas monitoreadas (Multimax, Panafoto, Rodelag, Almacenes Titán, Photura, Do it Center, Yoytec y PTYTEC). Recibe el nombre o el slug del producto.",
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
- Usa las tools (searchProducts, compareProductPrices, getBestDeals) para dar datos reales de las tiendas monitoreadas (Multimax, Panafoto, Rodelag, Almacenes Titán, Photura, Do it Center, Yoytec y PTYTEC). Nunca inventes precios.
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
  const llm = resolveLlmConfig();

  if (llm) {
    return sseResponse(async (send) => {
      await streamWithAiSdk(send, messages, llm);
    });
  }

  // Modo desarrollo determinista: tools reales + streaming español útil.
  return sseResponse(async (send) => {
    await streamDeterministic(send, userText);
  });
}

// ---------------------------------------------------------------------------
// Camino 1: Vercel AI SDK vía DeepSeek / OpenRouter
// ---------------------------------------------------------------------------
async function streamWithAiSdk(
  send: (event: SseEvent) => void,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  llm: NonNullable<ReturnType<typeof resolveLlmConfig>>
): Promise<void> {
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
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        fullText += part.textDelta;
        send({ type: "text-delta", delta: part.textDelta });
        break;
      case "tool-call":
        send({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          state: "loading",
          args: (part.args ?? {}) as Record<string, unknown>,
        });
        break;
      case "tool-result":
        send({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          state: "result",
          result: part.result,
        });
        break;
      case "error":
        send({
          type: "error",
          message:
            `El modelo de IA (${llm.provider}) no respondió. Verifica la API key o intenta de nuevo.`,
        });
        break;
      default:
        break;
    }
  }

  trackLlmGeneration({
    name: `regateo-ai-chat-${llm.provider}`,
    model: llm.model,
    input: messages.at(-1)?.content ?? "",
    output: fullText,
  });

  send({ type: "done" });
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
