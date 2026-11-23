import { createStoreRequestSchema, type StoreRequestSummaryDTO } from "@regateo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  MessageSquarePlus,
  Plus,
  Store,
} from "lucide-react";
import { useState } from "react";
import { useRealtimeStoreRequests } from "@/hooks/useRealtimeStoreRequests";
import { fetchPopularStoreRequests, submitStoreRequest } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

const CATEGORY_HINTS = [
  "Electrónica",
  "Línea Blanca",
  "Cómputo & Gaming",
  "Celulares",
  "Hogar / Ferretería",
] as const;

const MAX_COMMENT_CHARS = 300;

const SUPPORT_EMAIL_HREF =
  "mailto:soporte@regateo.pa?subject=Sugerencia%20de%20tienda%20-%20Regateo";

type SubmitOutcome =
  | { kind: "monitored"; storeName: string }
  | { kind: "duplicate"; storeName: string; votes: number }
  | { kind: "new"; storeName: string };

interface FormState {
  storeName: string;
  websiteUrl: string;
  categoryHint: string | null;
  contactEmail: string;
  details: string;
}

const EMPTY_FORM: FormState = {
  storeName: "",
  websiteUrl: "",
  categoryHint: null,
  contactEmail: "",
  details: "",
};

function outcomeFromResponse(
  storeName: string,
  response: { alreadyMonitored?: boolean; isDuplicateVote?: boolean; storeName?: string; request?: StoreRequestSummaryDTO }
): SubmitOutcome {
  const name = response.storeName ?? storeName;
  if (response.alreadyMonitored) {
    return { kind: "monitored", storeName: name };
  }
  if (response.isDuplicateVote) {
    return {
      kind: "duplicate",
      storeName: name,
      votes: response.request?.votes ?? 2,
    };
  }
  return { kind: "new", storeName: name };
}

function SuccessBanner({
  outcome,
  onViewStores,
}: {
  outcome: SubmitOutcome;
  onViewStores: () => void;
}) {
  if (outcome.kind === "monitored") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm font-medium text-[#047857]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            ¡Buenas noticias! Ya monitoreamos{" "}
            <strong>{outcome.storeName}</strong> en Regateo.
          </span>
        </p>
        <Button variant="outline" size="sm" onClick={onViewStores}>
          <Store className="h-3.5 w-3.5" />
          Ver tiendas monitoreadas
        </Button>
      </div>
    );
  }
  if (outcome.kind === "duplicate") {
    return (
      <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-sm font-medium text-[#047857]">
        <p className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            ¡Sumamos tu voto! Ya van{" "}
            <strong>{outcome.votes} personas pidiendo {outcome.storeName}</strong>.
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-sm font-medium text-[#047857]">
      <p className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <span>
          ¡Gracias! Registramos tu sugerencia para evaluar{" "}
          <strong>{outcome.storeName}</strong>.
        </span>
      </p>
    </div>
  );
}

export function SuggestStoreModal() {
  const open = useFilterStore((s) => s.suggestStoreOpen);
  const setOpen = useFilterStore((s) => s.setSuggestStoreOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [showDetails, setShowDetails] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [votedKeys, setVotedKeys] = useState<Set<string>>(new Set());

  const popularQuery = useQuery({
    queryKey: ["popular-store-requests"],
    queryFn: fetchPopularStoreRequests,
    enabled: open,
    staleTime: 60_000,
  });

  const realtimePopular = useRealtimeStoreRequests(open);

  const submitMutation = useMutation({
    mutationFn: submitStoreRequest,
    onSuccess: (response, input) => {
      setOutcome(outcomeFromResponse(input.storeName, response));
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["popular-store-requests"] });
    },
    onError: (error) => {
      setFieldErrors({ storeName: error instanceof Error ? error.message : "No pudimos enviar tu sugerencia. Inténtalo de nuevo." });
    },
  });

  const voteMutation = useMutation({
    mutationFn: (storeName: string) => submitStoreRequest({ storeName }),
    onSuccess: (response, storeName) => {
      setVotedKeys((prev) => new Set(prev).add(response.request?.normalizedKey ?? storeName.toLowerCase()));
      void queryClient.invalidateQueries({ queryKey: ["popular-store-requests"] });
    },
  });

  const handleClose = () => {
    setOpen(false);
    setOutcome(null);
    setFieldErrors({});
    setForm(EMPTY_FORM);
    setShowDetails(false);
    submitMutation.reset();
  };

  const handleViewStores = () => {
    handleClose();
    setActiveView("tiendas");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitMutation.isPending) return;

    const parsed = createStoreRequestSchema.safeParse({
      storeName: form.storeName,
      websiteUrl: form.websiteUrl || undefined,
      categoryHint: form.categoryHint ?? undefined,
      details: form.details || undefined,
      contactEmail: form.contactEmail || undefined,
    });

    if (!parsed.success) {
      const errors: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormState | undefined;
        if (key && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    submitMutation.mutate(parsed.data);
  };

  const popularItems = (realtimePopular.items ?? popularQuery.data?.items ?? []).slice(0, 6);
  const isVoting = (key: string) =>
    voteMutation.isPending && voteMutation.variables === key;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Sugerir tienda"
      description="¿Falta tu tienda favorita de Panamá? Dinos cuál y la comunidad puede votar para priorizarla."
      maxWidthClass="max-w-lg"
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5 sm:p-6">
        {outcome ? (
          <SuccessBanner outcome={outcome} onViewStores={handleViewStores} />
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="suggest-store-name"
              className="mb-1.5 block text-xs font-semibold text-[#111315]"
            >
              Nombre de la tienda <span className="text-[#E64825]">*</span>
            </label>
            <Input
              id="suggest-store-name"
              value={form.storeName}
              onChange={(e) => setForm((f) => ({ ...f, storeName: e.target.value }))}
              placeholder="Ej. PriceSmart, El Costo, Novey..."
              maxLength={80}
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors.storeName)}
            />
            {fieldErrors.storeName ? (
              <p className="mt-1 text-xs text-[#B83416]">{fieldErrors.storeName}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="suggest-store-website"
              className="mb-1.5 block text-xs font-semibold text-[#111315]"
            >
              Sitio web <span className="font-normal text-[#666D7C]">(opcional)</span>
            </label>
            <Input
              id="suggest-store-website"
              value={form.websiteUrl}
              onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
              placeholder="tienda.com.pa"
              maxLength={240}
              autoComplete="off"
              inputMode="url"
              aria-invalid={Boolean(fieldErrors.websiteUrl)}
            />
            {fieldErrors.websiteUrl ? (
              <p className="mt-1 text-xs text-[#B83416]">{fieldErrors.websiteUrl}</p>
            ) : null}
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-[#111315]">
              Categoría <span className="font-normal text-[#666D7C]">(opcional)</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_HINTS.map((hint) => {
                const active = form.categoryHint === hint;
                return (
                  <button
                    key={hint}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        categoryHint: f.categoryHint === hint ? null : hint,
                      }))
                    }
                    className={
                      active
                        ? "rounded-full border border-[#E64825] bg-[#FEF2EE] px-3 py-1 text-xs font-semibold text-[#B83416] cursor-pointer"
                        : "rounded-full border border-[#E7E5DF] bg-[#FAFAF7] px-3 py-1 text-xs font-medium text-[#525866] transition-colors hover:border-[#D5D2C9] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                    }
                  >
                    {hint}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="suggest-store-email"
              className="mb-1.5 block text-xs font-semibold text-[#111315]"
            >
              Correo electrónico{" "}
              <span className="font-normal text-[#666D7C]">
                (opcional: te avisamos cuando la agreguemos)
              </span>
            </label>
            <Input
              id="suggest-store-email"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              placeholder="tu@correo.com"
              maxLength={255}
              autoComplete="email"
              aria-invalid={Boolean(fieldErrors.contactEmail)}
            />
            {fieldErrors.contactEmail ? (
              <p className="mt-1 text-xs text-[#B83416]">{fieldErrors.contactEmail}</p>
            ) : null}
          </div>

          {showDetails ? (
            <div>
              <label
                htmlFor="suggest-store-details"
                className="mb-1.5 block text-xs font-semibold text-[#111315]"
              >
                Comentario{" "}
                <span className="font-normal text-[#666D7C]">(opcional, máx. 300)</span>
              </label>
              <textarea
                id="suggest-store-details"
                value={form.details}
                onChange={(e) =>
                  setForm((f) => ({ ...f, details: e.target.value.slice(0, MAX_COMMENT_CHARS) }))
                }
                rows={3}
                maxLength={MAX_COMMENT_CHARS}
                placeholder="Cualquier detalle útil: qué venden, sucursales, catálogo en línea..."
                className="w-full rounded-lg border border-[#E7E5DF] bg-white px-3 py-2 text-sm text-[#111315] placeholder:text-[#666D7C] transition-colors focus:border-[#E64825] focus:outline-none"
              />
              <p className="mt-1 text-right font-mono text-[11px] text-[#666D7C]">
                {form.details.length}/{MAX_COMMENT_CHARS}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#525866] transition-colors hover:text-[#111315] cursor-pointer"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Agregar comentario
            </button>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={submitMutation.isPending}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {submitMutation.isPending ? "Enviando..." : "Enviar sugerencia"}
          </Button>
        </form>

        {/* Más pedidas por la comunidad */}
        <div className="border-t border-[#E7E5DF] pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold tracking-[0.02em] text-[#525866] uppercase">
              Más pedidas por la comunidad
            </h3>
            {realtimePopular.isLive ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#047857]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                En vivo
              </span>
            ) : popularQuery.isFetching ? (
              <span className="text-[11px] text-[#666D7C]">Actualizando...</span>
            ) : null}
          </div>

          {popularQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, idx) => (
                <Skeleton key={idx} className="h-11 w-full" />
              ))}
            </div>
          ) : popularQuery.isError ? (
            <p className="text-xs text-[#666D7C]">
              No pudimos cargar las tiendas sugeridas ahora mismo.
            </p>
          ) : popularItems.length === 0 ? (
            <p className="text-xs text-[#666D7C]">
              Aún no hay tiendas sugeridas. ¡Sé la primera persona en pedir una!
            </p>
          ) : (
            <ul className="space-y-2">
              {popularItems.map((item) => {
                const voted = votedKeys.has(item.normalizedKey);
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#E7E5DF] bg-[#FAFAF7] px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[#111315]">
                        {item.storeName}
                      </span>
                      <Badge variant="muted">+{item.votes}</Badge>
                    </div>
                    <Button
                      type="button"
                      variant={voted ? "outline" : "brand"}
                      size="sm"
                      disabled={voted || isVoting(item.storeName)}
                      onClick={() => voteMutation.mutate(item.storeName)}
                    >
                      {voted ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          ¡Voto enviado!
                        </>
                      ) : (
                        <>
                          {isVoting(item.storeName) ? null : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                          {isVoting(item.storeName) ? "Enviando..." : "1 Pedir"}
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="border-t border-[#EFECE5] pt-3 text-[11px] leading-relaxed text-[#666D7C]">
          ¿Representas a una tienda o tienes una consulta directa?{" "}
          <a
            href={SUPPORT_EMAIL_HREF}
            className={cn("font-semibold text-[#111315] underline hover:text-[#E64825]")}
          >
            Escríbenos a soporte@regateo.pa
          </a>
        </p>
      </div>
    </Dialog>
  );
}
