import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type CaptchaConfigResponse,
  type CaptchaHeaders,
  fetchCaptchaChallenge,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: TurnstileRenderOptions
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileLoadPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Entorno sin navegador."));
  }
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (turnstileLoadPromise) {
    return turnstileLoadPromise;
  }

  turnstileLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`
    );

    const handleReady = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        turnstileLoadPromise = null;
        reject(new Error("Turnstile no se inicializó correctamente."));
      }
    };

    const handleError = () => {
      turnstileLoadPromise = null;
      reject(new Error("No se pudo cargar Cloudflare Turnstile."));
    };

    if (existing) {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      existing.addEventListener("load", handleReady, { once: true });
      existing.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleReady, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileLoadPromise;
}

export interface CaptchaWidgetProps {
  onChange: (value: CaptchaHeaders | null) => void;
  resetKey?: number;
  compact?: boolean;
  className?: string;
}

export function CaptchaWidget({
  onChange,
  resetKey = 0,
  compact = false,
  className,
}: CaptchaWidgetProps) {
  const inputId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  const [config, setConfig] = useState<CaptchaConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadChallenge = useCallback(async (cancelledRef: { current: boolean }) => {
    setLoading(true);
    setError(null);
    setAnswer("");
    setHoneypot("");
    setTurnstileVerified(false);
    onChangeRef.current(null);

    try {
      const data = await fetchCaptchaChallenge();
      if (!cancelledRef.current) {
        setConfig(data);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setConfig(null);
        setError(
          err instanceof Error
            ? err.message
            : "No pudimos cargar la verificación anti-bot."
        );
      }
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };
    void loadChallenge(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadChallenge, resetKey, refreshNonce]);

  const effectiveSiteKey =
    config?.provider === "turnstile"
      ? config.siteKey || import.meta.env.VITE_TURNSTILE_SITE_KEY || null
      : null;

  const isTurnstileMode =
    config?.provider === "turnstile" && Boolean(effectiveSiteKey);

  // Render Cloudflare Turnstile when active
  useEffect(() => {
    if (!isTurnstileMode || !effectiveSiteKey) return;
    let active = true;

    const mountTurnstile = async () => {
      try {
        const turnstile = await loadTurnstileScript();
        if (!active || !turnstileContainerRef.current) return;

        if (turnstileWidgetIdRef.current) {
          try {
            turnstile.remove(turnstileWidgetIdRef.current);
          } catch {
            // ignore cleanup error
          }
          turnstileWidgetIdRef.current = null;
        }

        turnstileContainerRef.current.innerHTML = "";

        const widgetId = turnstile.render(turnstileContainerRef.current, {
          sitekey: effectiveSiteKey,
          theme: "light",
          language: "es",
          callback: (token: string) => {
            if (!active) return;
            setTurnstileVerified(true);
            onChangeRef.current({ token });
          },
          "expired-callback": () => {
            if (!active) return;
            setTurnstileVerified(false);
            onChangeRef.current(null);
          },
          "error-callback": () => {
            if (!active) return;
            setTurnstileVerified(false);
            onChangeRef.current(null);
            setError("No se pudo validar el captcha. Intenta recargar.");
          },
        });
        turnstileWidgetIdRef.current = widgetId;
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo iniciar Cloudflare Turnstile."
        );
      }
    };

    void mountTurnstile();

    return () => {
      active = false;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // ignore cleanup error
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [isTurnstileMode, effectiveSiteKey, resetKey, refreshNonce]);

  // Emit builtin answer updates
  const handleBuiltinAnswerChange = (nextAnswer: string) => {
    const cleaned = nextAnswer.replace(/[^\d-]/g, "").slice(0, 6);
    setAnswer(cleaned);
    if (config?.challenge && cleaned.trim().length > 0) {
      onChangeRef.current({
        token: config.challenge.token,
        answer: cleaned.trim(),
        honeypot: honeypot || undefined,
      });
    } else {
      onChangeRef.current(null);
    }
  };

  const handleHoneypotChange = (nextHp: string) => {
    setHoneypot(nextHp);
    if (config?.challenge && answer.trim().length > 0) {
      onChangeRef.current({
        token: config.challenge.token,
        answer: answer.trim(),
        honeypot: nextHp || undefined,
      });
    }
  };

  const handleRefresh = () => {
    setRefreshNonce((prev) => prev + 1);
  };

  const isBuiltinReady =
    !isTurnstileMode &&
    Boolean(config?.challenge) &&
    answer.trim().length > 0;
  const isVerifiedVisual = isTurnstileMode ? turnstileVerified : isBuiltinReady;

  return (
    <div
      className={cn(
        "relative rounded-xl border transition-colors",
        isVerifiedVisual
          ? "border-[#A7F3D0] bg-[#ECFDF5]/60"
          : "border-[#E7E5DF] bg-[#FAFAF7]",
        compact ? "p-3" : "p-3.5",
        className
      )}
    >
      {/* Invisible honeypot field for automated bots */}
      <input
        type="text"
        name="website"
        value={honeypot}
        onChange={(e) => handleHoneypotChange(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck
            className={cn(
              "h-4 w-4 shrink-0",
              isVerifiedVisual ? "text-[#059669]" : "text-[#525866]"
            )}
            strokeWidth={2}
          />
          <span className="text-xs font-semibold text-[#111315]">
            Verificación anti-bot
          </span>
          {isVerifiedVisual ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#ECFDF5] px-1.5 py-0.5 text-[10px] font-semibold text-[#047857]">
              <CheckCircle2 className="h-3 w-3" />
              Listo
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          aria-label="Generar nuevo reto de verificación"
          title="Recargar reto"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-[#525866] transition-colors hover:bg-[#EFECE5] hover:text-[#111315] disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw
            className={cn("h-3 w-3", loading ? "animate-spin" : "")}
          />
          <span className="hidden sm:inline">Nuevo reto</span>
        </button>
      </div>

      <div className="mt-2.5">
        {loading ? (
          <div className="flex items-center gap-2 py-1.5 text-xs text-[#666D7C]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#525866]" />
            <span>Cargando verificación de seguridad...</span>
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-2 text-xs text-[#B91C1C]">
            <span>{error}</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="font-semibold underline hover:text-[#991B1B] cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        ) : isTurnstileMode ? (
          <div className="min-h-[65px] overflow-x-auto">
            <div ref={turnstileContainerRef} />
          </div>
        ) : config?.challenge ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <label
              htmlFor={inputId}
              className="inline-flex items-center rounded-lg border border-[#E7E5DF] bg-white px-3 py-1.5 font-mono text-xs font-bold tracking-tight text-[#111315] select-none"
            >
              {config.challenge.question}
            </label>
            <input
              id={inputId}
              type="text"
              inputMode="numeric"
              pattern="[0-9-]*"
              autoComplete="off"
              value={answer}
              onChange={(e) => handleBuiltinAnswerChange(e.target.value)}
              placeholder="Respuesta"
              aria-label={`Respuesta de verificación: ${config.challenge.question}`}
              className="h-8 w-28 rounded-lg border border-[#E7E5DF] bg-white px-2.5 font-mono text-sm font-semibold text-[#111315] placeholder:font-sans placeholder:text-xs placeholder:font-normal placeholder:text-[#666D7C] focus:border-[#E64825] focus:outline-none"
            />
          </div>
        ) : (
          <p className="text-xs text-[#666D7C]">
            Verificación no disponible en este momento. Intenta recargar.
          </p>
        )}
      </div>
    </div>
  );
}
