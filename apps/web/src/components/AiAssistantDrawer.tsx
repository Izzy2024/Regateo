import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Store,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type AiStreamEvent, streamAiChat } from "@/lib/api";
import { cn, formatUsd, sanitizeExternalUrl } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { Button } from "./ui/button";
import { Sheet } from "./ui/sheet";

interface ToolInvocationState {
  toolCallId: string;
  toolName: string;
  state: "loading" | "result" | "error";
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolInvocationState[];
  error?: string;
}

interface CompactProductResult {
  slug?: string;
  canonicalName?: string;
  name?: string;
  title?: string;
  bestPriceCents?: number;
  priceCents?: number;
  savingsCents?: number;
  savingsPercent?: number;
  storeName?: string;
  bestStore?: { name?: string; url?: string; color?: string } | null;
  url?: string;
}

const SUGGESTED_PROMPTS = [
  "¿Dónde está la lavadora más barata?",
  "Compara laptops bajo $700 en Panamá",
  "Mejores ofertas de hoy con mayor ahorro",
  "Smart TV de 55 pulgadas más económico",
];

function toolDisplayLabel(toolName: string, state: "loading" | "result" | "error"): string {
  const labels: Record<string, { loading: string; result: string }> = {
    searchProducts: {
      loading: "Buscando en Multimax, Panafoto, Rodelag, Titán...",
      result: "Catálogo consultado en tiempo real",
    },
    compareProductPrices: {
      loading: "Comparando precios entre tiendas panameñas...",
      result: "Comparación de tiendas completada",
    },
    getBestDeals: {
      loading: "Calculando mayores ahorros detectados hoy...",
      result: "Mejores ofertas verificadas",
    },
  };
  const entry = labels[toolName] ?? {
    loading: `Ejecutando ${toolName}...`,
    result: `Resultado de ${toolName}`,
  };
  if (state === "error") return `Error al consultar ${toolName}`;
  return state === "loading" ? entry.loading : entry.result;
}

function extractProductsFromToolResult(result: unknown): CompactProductResult[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const listCandidate = Array.isArray(result)
    ? result
    : Array.isArray(obj.items)
      ? obj.items
      : Array.isArray(obj.products)
        ? obj.products
        : Array.isArray(obj.deals)
          ? obj.deals
          : obj.product && typeof obj.product === "object"
            ? [obj.product]
            : [];

  return listCandidate
    .filter((entry): entry is CompactProductResult => Boolean(entry && typeof entry === "object"))
    .slice(0, 4);
}

function renderInlineMarkdown(line: string) {
  const tokens = line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return tokens.map((token, idx) => {
    const boldMatch = token.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      return (
        <strong key={idx} className="font-semibold text-[#111315]">
          {boldMatch[1]}
        </strong>
      );
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (linkMatch) {
      const safeUrl = sanitizeExternalUrl(linkMatch[2]);
      if (safeUrl) {
        return (
          <a
            key={idx}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#E64825] underline hover:text-[#B83416]"
          >
            {linkMatch[1]}
          </a>
        );
      }
    }
    return <span key={idx}>{token}</span>;
  });
}

export function AiAssistantDrawer() {
  const aiOpen = useFilterStore((s) => s.aiOpen);
  const aiInitialPrompt = useFilterStore((s) => s.aiInitialPrompt);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const openProduct = useFilterStore((s) => s.openProduct);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const consumedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const sendPrompt = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isStreaming) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        toolCalls: [],
      };
      const assistantId = `assistant-${Date.now() + 1}`;
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
      };

      const nextHistory = [...messages, userMsg];
      setMessages([...nextHistory, assistantPlaceholder]);
      setInput("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const handleEvent = (event: AiStreamEvent) => {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantId) return msg;

            if (event.type === "tool-call") {
              const exists = msg.toolCalls.some(
                (t) => t.toolCallId === event.toolCallId
              );
              const nextCalls: ToolInvocationState[] = exists
                ? msg.toolCalls
                : [
                    ...msg.toolCalls,
                    {
                      toolCallId: event.toolCallId,
                      toolName: event.toolName,
                      state: "loading",
                      args: event.args,
                    },
                  ];
              return { ...msg, toolCalls: nextCalls };
            }

            if (event.type === "tool-result") {
              const found = msg.toolCalls.some(
                (t) => t.toolCallId === event.toolCallId
              );
              const nextCalls: ToolInvocationState[] = found
                ? msg.toolCalls.map((t) =>
                    t.toolCallId === event.toolCallId
                      ? {
                          ...t,
                          state: event.state,
                          result: event.result,
                          error: event.error,
                        }
                      : t
                  )
                : [
                    ...msg.toolCalls,
                    {
                      toolCallId: event.toolCallId,
                      toolName: event.toolName,
                      state: event.state,
                      result: event.result,
                      error: event.error,
                    },
                  ];
              return { ...msg, toolCalls: nextCalls };
            }

            if (event.type === "text-delta") {
              return { ...msg, content: msg.content + event.delta };
            }

            if (event.type === "error") {
              return { ...msg, error: event.message };
            }

            return msg;
          })
        );
      };

      try {
        await streamAiChat(
          {
            messages: nextHistory.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            })),
          },
          handleEvent,
          controller.signal
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const errMessage =
            err instanceof Error
              ? err.message
              : "No se pudo conectar con Regateo AI.";
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, error: errMessage } : msg
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, messages]
  );

  // Trigger initial prompt when opened from Hero or Product Detail
  useEffect(() => {
    if (aiOpen && aiInitialPrompt && consumedPromptRef.current !== aiInitialPrompt) {
      consumedPromptRef.current = aiInitialPrompt;
      void sendPrompt(aiInitialPrompt);
    }
    if (!aiOpen) {
      consumedPromptRef.current = null;
    }
  }, [aiOpen, aiInitialPrompt, sendPrompt]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendPrompt(input);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
  };

  return (
    <Sheet
      open={aiOpen}
      onClose={() => setAiOpen(false)}
      side="right"
      title="Regateo AI"
      subtitle="Asistente en vivo con precios reales de Panamá"
      headerIcon={
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
          <Sparkles className="h-4 w-4" strokeWidth={2} />
        </span>
      }
      headerActions={
        messages.length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            title="Nueva conversación"
            aria-label="Nueva conversación"
            className="h-8 w-8"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        ) : null
      }
    >
      {/* Messages area */}
      <div className="flex-1 space-y-4 overflow-y-auto bg-[#FAFAF7] px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-4 pt-2">
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4">
              <p className="text-sm font-bold text-[#111315]">
                Consulta precios, compara modelos y encuentra el mayor ahorro.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#525866]">
                Consulto directamente la base de precios actualizada de Multimax,
                Panafoto, Rodelag, Almacenes Titán, Photura, Do it Center, Yoytec y
                PTYTEC.
              </p>
            </div>

            <div className="space-y-2">
              <span className="block text-[11px] font-bold tracking-[0.02em] text-[#666D7C] uppercase">
                Preguntas sugeridas
              </span>
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendPrompt(prompt)}
                  className="flex w-full items-center justify-between rounded-xl border border-[#E7E5DF] bg-white px-3.5 py-2.5 text-left text-[13px] font-medium text-[#111315] transition-colors hover:border-[#E64825] hover:bg-[#FEF2EE]/40 cursor-pointer"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#666D7C]" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col gap-2",
                msg.role === "user" ? "items-end" : "items-start"
              )}
            >
              {msg.role === "user" ? (
                <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-[#111315] px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
                  {msg.content}
                </div>
              ) : (
                <div className="w-full space-y-2">
                  {/* Tool call states */}
                  {msg.toolCalls.map((tool) => {
                    const products =
                      tool.state === "result"
                        ? extractProductsFromToolResult(tool.result)
                        : [];
                    return (
                      <div
                        key={tool.toolCallId}
                        className="rounded-xl border border-[#E7E5DF] bg-white p-3"
                      >
                        <div className="flex items-center gap-2 text-xs font-semibold">
                          {tool.state === "loading" ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#E64825]" />
                          ) : tool.state === "error" ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#DC2626]" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#059669]" />
                          )}
                          <span className="text-[#111315]">
                            {toolDisplayLabel(tool.toolName, tool.state)}
                          </span>
                        </div>

                        {tool.state === "error" && tool.error ? (
                          <p className="mt-1 text-xs text-[#DC2626]">{tool.error}</p>
                        ) : null}

                        {products.length > 0 ? (
                          <div className="mt-2.5 space-y-1.5">
                            {products.map((p, idx) => {
                              const title =
                                p.canonicalName || p.name || p.title || "Producto";
                              const priceCents = p.bestPriceCents ?? p.priceCents;
                              const storeName = p.bestStore?.name || p.storeName;
                              const directUrl = sanitizeExternalUrl(
                                p.bestStore?.url || p.url
                              );

                              return (
                                <div
                                  key={`${tool.toolCallId}-${p.slug ?? idx}`}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-[#EFECE5] bg-[#FAFAF7] px-2.5 py-2 text-xs"
                                >
                                  <button
                                    type="button"
                                    disabled={!p.slug}
                                    onClick={() => {
                                      if (p.slug) {
                                        setAiOpen(false);
                                        openProduct(p.slug);
                                      }
                                    }}
                                    className="min-w-0 flex-1 text-left cursor-pointer disabled:cursor-default"
                                  >
                                    <div className="truncate font-semibold text-[#111315] hover:text-[#E64825]">
                                      {title}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#525866]">
                                      {priceCents !== undefined ? (
                                        <span className="font-price font-bold text-[#047857]">
                                          {formatUsd(priceCents)}
                                        </span>
                                      ) : null}
                                      {storeName ? (
                                        <span className="inline-flex items-center gap-1 truncate">
                                          <Store className="h-2.5 w-2.5" />
                                          {storeName}
                                        </span>
                                      ) : null}
                                      {p.savingsCents && p.savingsCents >= 100 ? (
                                        <span className="font-price font-semibold text-[#B83416]">
                                          -{formatUsd(p.savingsCents)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </button>
                                  {directUrl ? (
                                    <a
                                      href={directUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`Abrir ${title} en tienda`}
                                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#E7E5DF] bg-white text-[#525866] hover:border-[#111315] hover:text-[#111315]"
                                    >
                                      <ArrowUpRight className="h-3.5 w-3.5" />
                                    </a>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* Assistant text bubble */}
                  {msg.content ? (
                    <div className="rounded-2xl rounded-bl-sm border border-[#E7E5DF] bg-white px-4 py-3 text-[13px] leading-relaxed text-[#111315]">
                      {msg.content.split("\n").map((line, i) => {
                        const trimmed = line.trim();
                        if (!trimmed) return <div key={i} className="h-2" />;
                        if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
                          return (
                            <div key={i} className="flex gap-2 py-0.5">
                              <span className="text-[#E64825]">•</span>
                              <span className="flex-1">
                                {renderInlineMarkdown(trimmed.slice(2))}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <p key={i} className="py-0.5">
                            {renderInlineMarkdown(line)}
                          </p>
                        );
                      })}
                    </div>
                  ) : isStreaming && !msg.error && msg.toolCalls.length === 0 ? (
                    <div className="inline-flex items-center gap-2 rounded-xl border border-[#E7E5DF] bg-white px-3.5 py-2.5 text-xs text-[#525866]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E64825]" />
                      Analizando catálogo de tiendas...
                    </div>
                  ) : null}

                  {msg.error ? (
                    <div className="flex items-start gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div>
                        <p className="font-semibold">No se pudo completar la respuesta</p>
                        <p className="mt-0.5">{msg.error}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-[#E7E5DF] bg-white p-3.5"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendPrompt(input);
              }
            }}
            placeholder="Pregunta por un producto, presupuesto o tienda..."
            disabled={isStreaming}
            className="flex-1 resize-none rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] px-3 py-2 text-sm text-[#111315] placeholder:text-[#666D7C] focus:border-[#E64825] focus:bg-white focus:outline-none disabled:opacity-60"
          />
          {isStreaming ? (
            <Button
              type="button"
              variant="primary"
              size="icon"
              onClick={handleStop}
              aria-label="Detener generación"
              className="h-10 w-10 shrink-0"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="brand"
              size="icon"
              disabled={!input.trim()}
              aria-label="Enviar pregunta"
              className="h-10 w-10 shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
