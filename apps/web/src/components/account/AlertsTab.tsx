import type { UpdateAlertInput, UserAlertDTO } from "@regateo/shared";
import {
  ArrowUpRight,
  Bell,
  BellOff,
  CheckCircle2,
  Loader2,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { buildOutboundUrl } from "@/lib/api";
import { cn, formatRelativeEs, formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductThumb } from "./ProductThumb";

function AlertCard({
  alert,
  onOpenProduct,
  onUpdateAlert,
  onDeleteAlert,
}: {
  alert: UserAlertDTO;
  onOpenProduct: (slug: string) => void;
  onUpdateAlert: (alertId: string, input: UpdateAlertInput) => Promise<unknown>;
  onDeleteAlert: (alertId: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftUsd, setDraftUsd] = useState(
    (alert.targetPriceCents / 100).toFixed(2)
  );
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const currentCents = alert.product.currentBestPriceCents;
  const targetCents = alert.targetPriceCents;
  const reached = alert.reachedTarget;
  const safeUrl = buildOutboundUrl(
    undefined,
    alert.product.bestStoreUrl,
    "account"
  );

  const gapCents =
    currentCents !== null ? Math.max(0, currentCents - targetCents) : null;

  const progressPercent = useMemo(() => {
    if (reached) return 100;
    if (currentCents === null || currentCents <= 0) return 15;
    if (currentCents <= targetCents) return 100;
    const ratio = (targetCents / currentCents) * 100;
    return Math.max(12, Math.min(95, Math.round(ratio)));
  }, [reached, currentCents, targetCents]);

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseFloat(draftUsd);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setEditError("Ingresa un monto válido mayor a $0.");
      return;
    }
    setEditError(null);
    setBusy(true);
    try {
      await onUpdateAlert(alert.id, {
        targetPriceCents: Math.round(parsed * 100),
      });
      setEditing(false);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "No se pudo actualizar el precio."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async () => {
    setBusy(true);
    try {
      await onUpdateAlert(alert.id, { active: !alert.active });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await onDeleteAlert(alert.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-4 card-elevation transition-colors",
        reached && alert.active
          ? "border-[#059669]/60 bg-[#ECFDF5]/25"
          : !alert.active
          ? "border-[#E7E5DF] opacity-80"
          : "border-[#E7E5DF]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            type="button"
            onClick={() => onOpenProduct(alert.product.slug)}
            className="cursor-pointer"
          >
            <ProductThumb
              imageUrl={alert.product.imageUrl}
              alt={alert.product.canonicalName}
              size="sm"
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {reached && alert.active ? (
                <Badge className="bg-[#059669] text-white">
                  <CheckCircle2 className="h-3 w-3" />
                  ¡Precio alcanzado!
                </Badge>
              ) : alert.active ? (
                <Badge variant="default" className="text-[11px]">
                  <Bell className="h-3 w-3 text-[#E64825]" />
                  Monitoreando
                </Badge>
              ) : (
                <Badge variant="muted" className="text-[11px]">
                  <BellOff className="h-3 w-3" />
                  Pausada
                </Badge>
              )}
              <span className="text-[11px] text-[#666D7C]">
                Creada {formatRelativeEs(alert.createdAt)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => onOpenProduct(alert.product.slug)}
              className="mt-1 line-clamp-2 text-left text-sm font-bold text-[#111315] hover:text-[#E64825] cursor-pointer"
            >
              {alert.product.canonicalName}
            </button>
          </div>
        </div>

        {/* Inline Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => {
              setDraftUsd((alert.targetPriceCents / 100).toFixed(2));
              setEditError(null);
              setEditing((prev) => !prev);
            }}
          >
            <Pencil className="h-3 w-3" />
            <span>Editar meta</span>
          </Button>

          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => void handleToggleActive()}
            title={alert.active ? "Pausar alerta" : "Reactivar alerta"}
          >
            {alert.active ? (
              <>
                <Pause className="h-3 w-3" />
                <span className="hidden sm:inline">Pausar</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 text-[#059669]" />
                <span className="hidden sm:inline">Activar</span>
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void handleDelete()}
            aria-label="Eliminar alerta"
            title="Eliminar alerta"
            className="text-[#666D7C] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Price Comparison + Visual Progress Bar */}
      <div className="mt-4 rounded-lg border border-[#EFECE5] bg-[#FAFAF7] p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="block text-[11px] font-semibold text-[#666D7C]">
              Tu precio objetivo
            </span>
            {editing ? (
              <form
                onSubmit={(e) => void handleSaveTarget(e)}
                className="mt-1 flex items-center gap-1.5"
              >
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[#666D7C]">
                    $
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    value={draftUsd}
                    onChange={(e) => setDraftUsd(e.target.value)}
                    className="h-8 pl-6 font-mono text-xs tabular-nums"
                  />
                </div>
                <Button type="submit" variant="brand" size="xs" disabled={busy}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditing(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </form>
            ) : (
              <span className="font-price text-lg font-bold text-[#111315]">
                {formatUsd(targetCents)}
              </span>
            )}
            {editError ? (
              <p className="mt-1 text-[11px] font-medium text-[#DC2626]">
                {editError}
              </p>
            ) : null}
          </div>

          <div className="sm:text-right">
            <span className="block text-[11px] font-semibold text-[#666D7C]">
              Mejor precio hoy
              {alert.product.bestStoreName
                ? ` · ${alert.product.bestStoreName}`
                : ""}
            </span>
            <span
              className={cn(
                "font-price text-lg font-bold",
                reached ? "text-[#047857]" : "text-[#111315]"
              )}
            >
              {currentCents !== null ? formatUsd(currentCents) : "Sin datos"}
            </span>
          </div>
        </div>

        {/* Progress toward target */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span
              className={cn(
                "font-semibold",
                reached ? "text-[#047857]" : "text-[#525866]"
              )}
            >
              {reached
                ? "¡El precio actual ya alcanzó o bajó de tu objetivo!"
                : gapCents !== null
                ? `Faltan ${formatUsd(gapCents)} para llegar a tu meta`
                : "Esperando próxima verificación de precio"}
            </span>
            <span className="font-mono font-semibold text-[#525866] tabular-nums">
              {progressPercent}%
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#E7E5DF]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                reached ? "bg-[#059669]" : "bg-[#E64825]"
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer link */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenProduct(alert.product.slug)}
          className="text-xs font-semibold text-[#525866] hover:text-[#E64825] cursor-pointer"
        >
          Ver historial y comparador →
        </button>

        {safeUrl && alert.product.bestStoreName ? (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold transition-colors",
              reached
                ? "bg-[#059669] text-white hover:bg-[#047857]"
                : "bg-[#111315] text-white hover:bg-[#E64825]"
            )}
          >
            <span>Ir a {alert.product.bestStoreName}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function AlertsTab({
  alerts,
  isLoading,
  onOpenProduct,
  onUpdateAlert,
  onDeleteAlert,
  onGoToCatalog,
}: {
  alerts: UserAlertDTO[];
  isLoading: boolean;
  onOpenProduct: (slug: string) => void;
  onUpdateAlert: (alertId: string, input: UpdateAlertInput) => Promise<unknown>;
  onDeleteAlert: (alertId: string) => Promise<unknown>;
  onGoToCatalog: () => void;
}) {
  return (
    <div className="mt-5">
      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, idx) => (
            <Skeleton key={idx} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#D5D2C9] bg-white px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#F4F3EE] text-[#111315]">
            <Bell className="h-6 w-6" />
          </span>
          <h2 className="mt-3 text-base font-bold text-[#111315]">
            No tienes alertas de precio activas
          </h2>
          <p className="mt-1 max-w-md text-sm text-[#525866]">
            Abre cualquier producto y fija el precio en USD al que te gustaría
            comprarlo. Monitoreamos todas las tiendas y te avisamos al alcanzarlo.
          </p>
          <Button
            variant="brand"
            className="mt-5"
            onClick={onGoToCatalog}
          >
            Buscar productos para monitorear
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onOpenProduct={onOpenProduct}
              onUpdateAlert={onUpdateAlert}
              onDeleteAlert={onDeleteAlert}
            />
          ))}
        </div>
      )}
    </div>
  );
}
