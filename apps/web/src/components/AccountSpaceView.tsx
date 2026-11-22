import type {
  FavoriteProductDTO,
  ShoppingListDTO,
  UserAlertDTO,
} from "@regateo/shared";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ClipboardList,
  FolderPlus,
  GitCompareArrows,
  Heart,
  ListPlus,
  Loader2,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { useUserSpace } from "@/hooks/useUserSpace";
import {
  cn,
  formatRelativeEs,
  formatUsd,
  getCategoryShortLabel,
  sanitizeExternalUrl,
} from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CategoryIcon } from "./CategoryIcon";
import { BlurFade } from "./magicui/blur-fade";
import { NumberTicker } from "./magicui/number-ticker";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

type SpaceTab = "favoritos" | "listas" | "alertas";
type FavFilter = "all" | "drops";

const QUICK_LIST_PRESETS = [
  { name: "Mi Setup PC", description: "Laptop, monitor, periféricos y accesorios" },
  { name: "Línea Blanca Hogar", description: "Lavadora, nevera, aire y cocina" },
  { name: "Upgrade Gaming", description: "Consola, audífonos, monitor y mouse" },
  { name: "Regalos", description: "Ideas seleccionadas para comparar precios" },
];

function ProductThumb({
  imageUrl,
  alt,
  category,
  size = "md",
}: {
  imageUrl: string | null;
  alt: string;
  category?: FavoriteProductDTO["product"]["category"];
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const dimClass = size === "sm" ? "h-12 w-12" : "h-16 w-16";

  if (!imageUrl || failed) {
    return (
      <div
        className={cn(
          dimClass,
          "flex shrink-0 items-center justify-center rounded-lg border border-[#E7E5DF] bg-[#F7F6F2] text-[#666D7C]"
        )}
      >
        {category ? (
          <CategoryIcon category={category} className="h-5 w-5" />
        ) : (
          <ShoppingBag className="h-5 w-5" />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        dimClass,
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E7E5DF] bg-[#F7F6F2] p-1.5"
      )}
    >
      <img
        src={imageUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain mix-blend-multiply"
      />
    </div>
  );
}

function FavoriteCard({
  fav,
  lists,
  onOpenProduct,
  onRemoveFavorite,
  onAddToList,
  onGoToListsTab,
}: {
  fav: FavoriteProductDTO;
  lists: ShoppingListDTO[];
  onOpenProduct: (slug: string) => void;
  onRemoveFavorite: (productId: string) => void;
  onAddToList: (listId: string, productId: string) => Promise<unknown>;
  onGoToListsTab: () => void;
}) {
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [addingListId, setAddingListId] = useState<string | null>(null);
  const [justAddedListId, setJustAddedListId] = useState<string | null>(null);

  const product = fav.product;
  const delta = fav.priceChangeSinceSavedCents;
  const dropped = delta < 0;
  const increased = delta > 0;
  const bestStoreUrl = sanitizeExternalUrl(product.bestStore?.url);

  const handleQuickAdd = async (listId: string) => {
    setAddingListId(listId);
    try {
      await onAddToList(listId, fav.productId);
      setJustAddedListId(listId);
      window.setTimeout(() => {
        setJustAddedListId(null);
        setListMenuOpen(false);
      }, 900);
    } finally {
      setAddingListId(null);
    }
  };

  return (
    <article
      className={cn(
        "relative flex h-full flex-col rounded-xl border bg-white p-4 card-elevation transition-[border-color,box-shadow] duration-150",
        dropped
          ? "border-[#A7F3D0] hover:border-[#059669]/60"
          : "border-[#E7E5DF] hover:border-[#D5D2C9]"
      )}
    >
      {/* Top Row: Image + Meta + Remove */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onOpenProduct(product.slug)}
          className="cursor-pointer"
          aria-label={`Ver detalles de ${product.canonicalName}`}
        >
          <ProductThumb
            imageUrl={product.imageUrl}
            alt={product.canonicalName}
            category={product.category}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-[#666D7C]">
              {product.brand || getCategoryShortLabel(product.category)}
            </span>
            <button
              type="button"
              onClick={() => onRemoveFavorite(fav.productId)}
              title="Quitar de favoritos"
              aria-label={`Quitar ${product.canonicalName} de favoritos`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#FBCFC3] bg-[#FEF2EE] text-[#E64825] transition-colors hover:bg-[#FDE5DC] cursor-pointer"
            >
              <Heart className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenProduct(product.slug)}
            className="mt-0.5 line-clamp-2 text-left text-[14px] leading-snug font-bold tracking-[-0.015em] text-[#111315] transition-colors hover:text-[#E64825] cursor-pointer"
          >
            {product.canonicalName}
          </button>
        </div>
      </div>

      {/* Price Radar Comparison Box */}
      <div
        className={cn(
          "mt-3.5 rounded-lg border p-3",
          dropped
            ? "border-[#A7F3D0] bg-[#ECFDF5]"
            : "border-[#EFECE5] bg-[#FAFAF7]"
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <span className="block text-[11px] font-semibold text-[#525866]">
              Mejor precio hoy
            </span>
            <span
              className={cn(
                "font-price text-[22px] leading-tight font-bold",
                dropped ? "text-[#047857]" : "text-[#111315]"
              )}
            >
              {formatUsd(fav.currentBestPriceCents)}
            </span>
          </div>

          {product.bestStore ? (
            <span
              className="inline-flex max-w-[130px] items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[11px] font-bold"
              style={{
                borderColor: `${product.bestStore.color}33`,
                color: product.bestStore.color,
              }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: product.bestStore.color }}
              />
              <span className="truncate">{product.bestStore.name}</span>
            </span>
          ) : null}
        </div>

        {/* Saved Price Baseline + Delta Badge */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-black/5 pt-2">
          <span className="text-[11px] text-[#525866]">
            Guardado a{" "}
            <strong className="font-price font-semibold text-[#111315]">
              {formatUsd(fav.savedPriceCents)}
            </strong>
          </span>

          {dropped ? (
            <Badge variant="best" className="font-mono text-[11px] tabular-nums">
              <TrendingDown className="h-3 w-3" />
              Bajó -{formatUsd(Math.abs(delta))} desde que lo guardaste
            </Badge>
          ) : increased ? (
            <Badge variant="savingsSoft" className="font-mono text-[11px] tabular-nums">
              <TrendingUp className="h-3 w-3" />
              Subió +{formatUsd(delta)}
            </Badge>
          ) : (
            <Badge variant="muted" className="text-[11px]">
              Sin cambios
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-auto pt-3.5 space-y-2">
        {/* Quick Add to List Dropdown */}
        <div className="relative">
          <Button
            variant="outline"
            size="xs"
            onClick={() => setListMenuOpen((prev) => !prev)}
            className="w-full justify-between"
          >
            <span className="inline-flex items-center gap-1.5">
              <ListPlus className="h-3.5 w-3.5 text-[#525866]" />
              <span>Añadir a lista</span>
            </span>
            <span className="font-mono text-[10px] text-[#666D7C]">
              {lists.length > 0 ? `${lists.length} disp.` : "Crear"}
            </span>
          </Button>

          {listMenuOpen ? (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-1.5 rounded-xl border border-[#E7E5DF] bg-white p-2 shadow-lg">
              <div className="mb-1.5 flex items-center justify-between px-1.5">
                <span className="text-[11px] font-bold text-[#525866]">
                  Elegir lista de presupuesto
                </span>
                <button
                  type="button"
                  onClick={() => setListMenuOpen(false)}
                  aria-label="Cerrar menú de listas"
                  className="rounded p-0.5 text-[#666D7C] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {lists.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setListMenuOpen(false);
                    onGoToListsTab();
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#D5D2C9] bg-[#FAFAF7] px-2.5 py-2 text-xs font-semibold text-[#E64825] hover:bg-[#FEF2EE] cursor-pointer"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Crear mi primera lista
                </button>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {lists.map((list) => {
                    const alreadyInList = list.items.some(
                      (i) => i.productId === fav.productId
                    );
                    const isAdding = addingListId === list.id;
                    const justAdded = justAddedListId === list.id;
                    return (
                      <button
                        key={list.id}
                        type="button"
                        disabled={isAdding}
                        onClick={() => void handleQuickAdd(list.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-[#111315] transition-colors hover:bg-[#F4F3EE] cursor-pointer disabled:opacity-60"
                      >
                        <span className="truncate">{list.name}</span>
                        {isAdding ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#525866]" />
                        ) : justAdded || alreadyInList ? (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[#059669]">
                            <Check className="h-3.5 w-3.5" />
                            {justAdded ? "Añadido" : "En lista"}
                          </span>
                        ) : (
                          <Plus className="h-3.5 w-3.5 shrink-0 text-[#666D7C]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenProduct(product.slug)}
            className="w-full gap-1 px-2 text-xs"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            <span>Ver comparador</span>
          </Button>

          {bestStoreUrl && product.bestStore ? (
            <a
              href={bestStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-[#111315] px-2 text-xs font-semibold text-white transition-colors hover:bg-[#E64825]"
            >
              <span className="truncate">Ir a {product.bestStore.name}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOpenProduct(product.slug)}
              className="w-full text-xs"
            >
              Ver ficha
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function ShoppingListCard({
  list,
  onDeleteList,
  onRemoveItem,
  onOpenProduct,
  onExploreCatalog,
}: {
  list: ShoppingListDTO;
  onDeleteList: (listId: string) => Promise<unknown>;
  onRemoveItem: (listId: string, productId: string) => Promise<unknown>;
  onOpenProduct: (slug: string) => void;
  onExploreCatalog: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Group items by winning store so the user gets an instant optimal shopping plan
  const storeBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        slug: string;
        name: string;
        color: string;
        units: number;
        subtotalCents: number;
      }
    >();

    for (const item of list.items) {
      const store = item.product.bestStore;
      if (!store) continue;
      const existing = map.get(store.slug);
      const itemTotal = item.product.bestPriceCents * item.quantity;
      if (existing) {
        existing.units += item.quantity;
        existing.subtotalCents += itemTotal;
      } else {
        map.set(store.slug, {
          slug: store.slug,
          name: store.name,
          color: store.color,
          units: item.quantity,
          subtotalCents: itemTotal,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.units - a.units);
  }, [list.items]);

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteList(list.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
      {/* List Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-extrabold tracking-[-0.02em] text-[#111315]">
              {list.name}
            </h3>
            <Badge variant="default" className="font-mono text-[11px]">
              {list.itemCount} {list.itemCount === 1 ? "producto" : "productos"}
            </Badge>
          </div>
          {list.description ? (
            <p className="mt-1 text-xs text-[#525866]">{list.description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {confirmDelete ? (
            <>
              <Button
                variant="destructive"
                size="xs"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  "Confirmar borrado"
                )}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancelar
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setConfirmDelete(true)}
              className="text-[#666D7C] hover:text-[#DC2626]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Eliminar lista</span>
            </Button>
          )}
        </div>
      </div>

      {/* Optimized Budget Bar */}
      {list.items.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <span className="block text-[11px] font-semibold text-[#047857]">
                  Costo total optimizado (mejor tienda por producto)
                </span>
                <span className="font-price text-2xl font-bold text-[#047857]">
                  {formatUsd(list.totalBestPriceCents)}
                </span>
              </div>

              {list.totalSavingsCents >= 100 ? (
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-[#065F46]">
                    vs. opción más cara ({formatUsd(list.totalHighestPriceCents)})
                  </span>
                  <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-md bg-[#059669] px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-white">
                    <TrendingDown className="h-3.5 w-3.5" />
                    Ahorras {formatUsd(list.totalSavingsCents)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {storeBreakdown.length > 0 ? (
            <div className="mt-3 border-t border-[#A7F3D0]/80 pt-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-[#065F46]">
                  <Store className="h-3.5 w-3.5" />
                  Plan de compra sugerido:
                </span>
                {storeBreakdown.map((entry) => (
                  <span
                    key={entry.slug}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#111315]"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span>
                      Compra{" "}
                      <strong className="font-mono">{entry.units}</strong> en{" "}
                      {entry.name}
                    </span>
                    <span className="font-price text-[#047857]">
                      ({formatUsd(entry.subtotalCents)})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Items List */}
      {list.items.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[#D5D2C9] bg-[#FAFAF7] px-4 py-5">
          <p className="text-xs text-[#525866]">
            Esta lista está vacía. Abre cualquier producto y pulsa{" "}
            <strong className="font-semibold text-[#111315]">
              “Guardar en lista”
            </strong>{" "}
            para armar tu presupuesto optimizado.
          </p>
          <Button variant="outline" size="xs" onClick={onExploreCatalog}>
            Explorar productos
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-[#EFECE5] rounded-xl border border-[#EFECE5]">
          {list.items.map((item) => {
            const safeUrl = sanitizeExternalUrl(item.product.bestStore?.url);
            const subtotal = item.product.bestPriceCents * item.quantity;
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 transition-colors hover:bg-[#FAFAF7]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenProduct(item.product.slug)}
                    className="cursor-pointer"
                  >
                    <ProductThumb
                      imageUrl={item.product.imageUrl}
                      alt={item.product.canonicalName}
                      category={item.product.category}
                      size="sm"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenProduct(item.product.slug)}
                      className="line-clamp-1 text-left text-[13px] font-bold text-[#111315] hover:text-[#E64825] cursor-pointer"
                    >
                      {item.product.canonicalName}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#525866]">
                      <span className="rounded bg-[#F4F3EE] px-1.5 py-0.5 font-mono font-semibold text-[#111315]">
                        Cant. {item.quantity}
                      </span>
                      {item.product.bestStore ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#111315]">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: item.product.bestStore.color }}
                          />
                          {item.product.bestStore.name}
                        </span>
                      ) : null}
                      {item.quantity > 1 ? (
                        <span className="font-price text-[#666D7C]">
                          {formatUsd(item.product.bestPriceCents)} c/u
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  <span className="font-price text-sm font-bold text-[#047857]">
                    {formatUsd(subtotal)}
                  </span>

                  {safeUrl && item.product.bestStore ? (
                    <a
                      href={safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#111315] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#E64825]"
                    >
                      <span>Ir a tienda</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void onRemoveItem(list.id, item.productId)}
                    aria-label={`Quitar ${item.product.canonicalName} de ${list.name}`}
                    title="Quitar de la lista"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#666D7C] transition-colors hover:bg-[#FEF2F2] hover:text-[#DC2626] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function AlertCard({
  alert,
  onOpenProduct,
  onUpdateAlert,
  onDeleteAlert,
}: {
  alert: UserAlertDTO;
  onOpenProduct: (slug: string) => void;
  onUpdateAlert: (
    alertId: string,
    input: { targetPriceCents?: number; active?: boolean }
  ) => Promise<unknown>;
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
  const safeUrl = sanitizeExternalUrl(alert.product.bestStoreUrl);

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

export function AccountSpaceView() {
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const openProduct = useFilterStore((s) => s.openProduct);
  const toggleGuestFavorite = useFilterStore((s) => s.toggleGuestFavorite);

  const {
    user,
    isAuthenticated,
    isLoadingSession,
    overview,
    isLoadingOverview,
    isErrorOverview,
    overviewError,
    refetchOverview,
    favorites,
    lists,
    alerts,
    guestFavoriteIds,
    guestFavoriteItems,
    toggleFavorite,
    createList,
    isCreatingList,
    deleteList,
    addToList,
    removeFromList,
    updateAlert,
    deleteAlert,
    signOut,
  } = useUserSpace();

  const [activeTab, setActiveTab] = useState<SpaceTab>("favoritos");
  const [favFilter, setFavFilter] = useState<FavFilter>("all");
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [creatingPreset, setCreatingPreset] = useState<string | null>(null);

  const droppedFavorites = useMemo(
    () => favorites.filter((f) => f.priceChangeSinceSavedCents < 0),
    [favorites]
  );

  const displayedFavorites = useMemo(() => {
    const source = favFilter === "drops" ? droppedFavorites : favorites;
    return [...source].sort(
      (a, b) => a.priceChangeSinceSavedCents - b.priceChangeSinceSavedCents
    );
  }, [favorites, droppedFavorites, favFilter]);

  const existingListNames = useMemo(
    () => new Set(lists.map((l) => l.name.trim().toLowerCase())),
    [lists]
  );

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (trimmed.length < 2) {
      setListError("Escribe un nombre de al menos 2 caracteres.");
      return;
    }
    setListError(null);
    try {
      await createList({
        name: trimmed,
        description: newListDesc.trim() || undefined,
      });
      setNewListName("");
      setNewListDesc("");
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "No se pudo crear la lista."
      );
    }
  };

  const handleQuickPresetList = async (preset: {
    name: string;
    description: string;
  }) => {
    setListError(null);
    setCreatingPreset(preset.name);
    try {
      await createList({
        name: preset.name,
        description: preset.description,
      });
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "No se pudo crear la lista."
      );
    } finally {
      setCreatingPreset(null);
    }
  };

  // Loading session state
  if (isLoadingSession) {
    return (
      <section className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-64 w-full rounded-xl" />
      </section>
    );
  }

  // =========================================================================
  // GUEST EXPERIENCE: Persuasive value preview + local favorites ready to sync
  // =========================================================================
  if (!isAuthenticated || !user) {
    return (
      <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
        <BlurFade duration={0.32} yOffset={6}>
          <div className="overflow-hidden rounded-2xl border border-[#E7E5DF] bg-white card-elevation">
            <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <Badge variant="savingsSoft" className="mb-3">
                  <Sparkles className="h-3 w-3" />
                  Mi Espacio · 100% gratis
                </Badge>
                <h1 className="text-2xl leading-[1.15] font-extrabold tracking-[-0.03em] text-[#111315] text-balance sm:text-4xl">
                  Ahorra en automático con tu radar personal de precios en Panamá.
                </h1>
                <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-[#525866]">
                  Crea tu cuenta gratuita en segundos para rastrear bajadas de precio en
                  tus favoritos, armar presupuestos optimizados entre las 8 tiendas activas
                  y controlar todas tus alertas desde un solo lugar.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    variant="brand"
                    size="lg"
                    onClick={() => setAuthOpen(true, { mode: "signup" })}
                  >
                    Crear cuenta gratis
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setAuthOpen(true, { mode: "signin" })}
                  >
                    Iniciar sesión
                  </Button>
                </div>
              </div>

              {/* Compact preview highlight card */}
              <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-5">
                <span className="text-[11px] font-bold tracking-[0.03em] text-[#047857] uppercase">
                  Ejemplo de ahorro en tu espacio
                </span>
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between rounded-lg border border-[#A7F3D0]/80 bg-white px-3 py-2.5 text-xs">
                    <div>
                      <p className="font-bold text-[#111315]">Lista “Mi Setup PC”</p>
                      <p className="text-[11px] text-[#525866]">
                        2 en Yoytec · 1 en Multimax · 1 en Panafoto
                      </p>
                    </div>
                    <span className="rounded-md bg-[#059669] px-2 py-1 font-mono text-[11px] font-bold text-white">
                      -$142.50
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[#A7F3D0]/80 bg-white px-3 py-2.5 text-xs">
                    <div>
                      <p className="font-bold text-[#111315]">Radar de favoritos</p>
                      <p className="text-[11px] text-[#525866]">
                        Guardado a $599.00 → Hoy $529.00
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#047857]">
                      Bajó -$70.00
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </BlurFade>

        {/* 3 Real Benefits Grid */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
              <TrendingDown className="h-5 w-5" />
            </span>
            <h2 className="mt-3.5 text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
              1. Radar personal de bajadas de precio
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
              Cada vez que guardas un favorito, registramos su precio exacto ese día y te
              avisamos cuánto ha bajado en Multimax, Panafoto, Rodelag, Titán, Photura,
              Do it Center, Yoytec o PTYTEC.
            </p>
          </div>

          <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
              <ClipboardList className="h-5 w-5" />
            </span>
            <h2 className="mt-3.5 text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
              2. Listas y presupuestos inteligentes
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
              Crea listas por proyecto (“Mi Setup PC”, “Línea Blanca Hogar”) y calculamos
              automáticamente dónde comprar cada artículo para pagar el mínimo total en
              Panamá.
            </p>
          </div>

          <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4F3EE] text-[#111315]">
              <Bell className="h-5 w-5" />
            </span>
            <h2 className="mt-3.5 text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
              3. Gestión centralizada de alertas
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
              Visualiza qué tan cerca está cada producto de tu precio objetivo en USD,
              detecta al instante metas alcanzadas y edita o pausa alertas con un clic.
            </p>
          </div>
        </div>

        {/* Local Guest Favorites Ready to Sync */}
        {guestFavoriteIds.length > 0 ? (
          <div className="mt-8 rounded-2xl border border-[#E7E5DF] bg-white p-5 sm:p-6 card-elevation">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE5] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-[#E64825]" fill="currentColor" />
                  <h2 className="text-base font-bold text-[#111315]">
                    Tus favoritos guardados en este navegador ({guestFavoriteIds.length})
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-[#525866]">
                  Al iniciar sesión o crear tu cuenta gratuita, estos productos se
                  sincronizarán automáticamente en tu Radar Personal sin perder nada.
                </p>
              </div>
              <Button
                variant="brand"
                size="sm"
                onClick={() => setAuthOpen(true, { mode: "signup" })}
              >
                Sincronizar en mi cuenta
              </Button>
            </div>

            {guestFavoriteItems.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {guestFavoriteItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openProduct(item.slug)}
                        className="cursor-pointer"
                      >
                        <ProductThumb
                          imageUrl={item.imageUrl}
                          alt={item.canonicalName}
                          category={item.category}
                          size="sm"
                        />
                      </button>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => openProduct(item.slug)}
                          className="line-clamp-1 text-left text-xs font-bold text-[#111315] hover:text-[#E64825] cursor-pointer"
                        >
                          {item.canonicalName}
                        </button>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                          <span className="font-price font-bold text-[#047857]">
                            {formatUsd(item.bestPriceCents)}
                          </span>
                          {item.bestStoreName ? (
                            <span className="truncate text-[11px] text-[#666D7C]">
                              · {item.bestStoreName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGuestFavorite(item.id)}
                      aria-label={`Quitar ${item.canonicalName} de guardados locales`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#666D7C] hover:bg-white hover:text-[#DC2626] cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-xs text-[#525866]">
                Tienes{" "}
                <strong className="font-mono text-[#111315]">
                  {guestFavoriteIds.length}
                </strong>{" "}
                {guestFavoriteIds.length === 1
                  ? "producto listo"
                  : "productos listos"}{" "}
                para migrarse al iniciar sesión.
              </p>
            )}
          </div>
        ) : null}
      </section>
    );
  }

  // =========================================================================
  // AUTHENTICATED EXPERIENCE: Mi Espacio Dashboard
  // =========================================================================
  const firstName =
    (user.name || user.email.split("@")[0] || "Usuario").split(" ")[0];
  const stats = overview?.stats ?? {
    favoritesCount: favorites.length,
    activeAlertsCount: alerts.filter((a) => a.active).length,
    reachedAlertsCount: alerts.filter((a) => a.active && a.reachedTarget).length,
    listsCount: lists.length,
    priceDropsSinceSavedCount: droppedFavorites.length,
    totalPotentialSavingsCents: 0,
  };

  return (
    <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Personal Header */}
      <BlurFade duration={0.28} yOffset={6}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E7E5DF] pb-6">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#111315] text-lg font-extrabold text-white uppercase">
              {(user.name || user.email).slice(0, 1)}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#111315] sm:text-3xl">
                  Hola, {firstName}
                </h1>
                <Badge variant="best" className="text-[11px]">
                  Mi Espacio activo
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[#525866]">
                {user.email} · Sincronizado en las 8 tiendas activas de Panamá
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveView("catalogo")}
            >
              Explorar catálogo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              className="text-[#525866] hover:text-[#DC2626]"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Cerrar sesión</span>
            </Button>
          </div>
        </div>
      </BlurFade>

      {/* Error State */}
      {isErrorOverview && !overview ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-[#E64825]" />
          <h2 className="mt-3 text-base font-bold text-[#111315]">
            No pudimos cargar tu espacio personal
          </h2>
          <p className="mt-1 max-w-md text-sm text-[#525866]">
            {overviewError instanceof Error
              ? overviewError.message
              : "Intenta recargar en unos segundos."}
          </p>
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => void refetchOverview()}
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          {/* 4 KPI Cards with NumberTicker */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* KPI 1: Favoritos */}
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#525866]">
                  Favoritos guardados
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                  <Heart className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 font-price text-3xl font-bold text-[#111315]">
                {isLoadingOverview && !overview ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <NumberTicker value={stats.favoritesCount} />
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#666D7C]">
                en tu radar personal de precios
              </p>
            </div>

            {/* KPI 2: Bajadas detectadas */}
            <div
              className={cn(
                "rounded-xl border p-4 card-elevation transition-colors",
                stats.priceDropsSinceSavedCount > 0
                  ? "border-[#A7F3D0] bg-[#ECFDF5]"
                  : "border-[#E7E5DF] bg-white"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    stats.priceDropsSinceSavedCount > 0
                      ? "text-[#047857]"
                      : "text-[#525866]"
                  )}
                >
                  Bajadas de precio detectadas
                </span>
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg",
                    stats.priceDropsSinceSavedCount > 0
                      ? "bg-[#059669] text-white"
                      : "bg-[#F4F3EE] text-[#525866]"
                  )}
                >
                  <TrendingDown className="h-4 w-4" />
                </span>
              </div>
              <div
                className={cn(
                  "mt-2 font-price text-3xl font-bold",
                  stats.priceDropsSinceSavedCount > 0
                    ? "text-[#059669]"
                    : "text-[#111315]"
                )}
              >
                {isLoadingOverview && !overview ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <NumberTicker value={stats.priceDropsSinceSavedCount} />
                )}
              </div>
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  stats.priceDropsSinceSavedCount > 0
                    ? "font-medium text-[#065F46]"
                    : "text-[#666D7C]"
                )}
              >
                {stats.priceDropsSinceSavedCount > 0
                  ? "bajaron desde que los guardaste"
                  : "te avisaremos al detectar una baja"}
              </p>
            </div>

            {/* KPI 3: Alertas activas */}
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#525866]">
                  Alertas activas
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F4F3EE] text-[#111315]">
                  <Bell className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-price text-3xl font-bold text-[#111315]">
                  {isLoadingOverview && !overview ? (
                    <Skeleton className="h-9 w-16" />
                  ) : (
                    <NumberTicker value={stats.activeAlertsCount} />
                  )}
                </span>
                {stats.reachedAlertsCount > 0 ? (
                  <Badge className="bg-[#059669] text-white text-[11px]">
                    {stats.reachedAlertsCount}{" "}
                    {stats.reachedAlertsCount === 1 ? "alcanzada" : "alcanzadas"}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-[#666D7C]">
                {stats.reachedAlertsCount > 0
                  ? "¡Ya tienes metas alcanzadas hoy!"
                  : "monitoreando tu precio objetivo"}
              </p>
            </div>

            {/* KPI 4: Ahorro potencial detectado */}
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#525866]">
                  Ahorro potencial detectado
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
                  <Sparkles className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 font-price text-3xl font-bold text-[#047857]">
                {isLoadingOverview && !overview ? (
                  <Skeleton className="h-9 w-28" />
                ) : (
                  <>
                    $
                    <NumberTicker
                      value={stats.totalPotentialSavingsCents / 100}
                      decimalPlaces={2}
                    />
                  </>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#666D7C]">
                USD acumulados entre favoritos y listas
              </p>
            </div>
          </div>

          {/* 3 Main Tabs */}
          <div className="mt-8">
            <div
              role="tablist"
              aria-label="Secciones de Mi Espacio"
              className="inline-flex w-full flex-wrap gap-1 rounded-xl border border-[#E7E5DF] bg-white p-1.5 sm:w-auto"
            >
              {(
                [
                  {
                    id: "favoritos" as const,
                    label: "Favoritos",
                    icon: Heart,
                    count: favorites.length,
                    highlight: stats.priceDropsSinceSavedCount > 0,
                  },
                  {
                    id: "listas" as const,
                    label: "Listas y Presupuestos",
                    icon: ClipboardList,
                    count: lists.length,
                    highlight: false,
                  },
                  {
                    id: "alertas" as const,
                    label: "Alertas de Precio",
                    icon: Bell,
                    count: alerts.length,
                    highlight: stats.reachedAlertsCount > 0,
                  },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors sm:flex-none sm:text-[13px] cursor-pointer",
                      active
                        ? "text-[#111315]"
                        : "text-[#525866] hover:text-[#111315]"
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="account-space-tab-pill"
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 rounded-lg border border-[#E7E5DF] bg-[#F4F3EE]"
                      />
                    ) : null}
                    <Icon
                      className={cn(
                        "relative z-10 h-3.5 w-3.5",
                        active && tab.id === "favoritos" ? "text-[#E64825]" : ""
                      )}
                    />
                    <span className="relative z-10">{tab.label}</span>
                    <span
                      className={cn(
                        "relative z-10 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                        tab.highlight
                          ? "bg-[#059669] text-white"
                          : active
                          ? "bg-white text-[#111315]"
                          : "bg-[#F4F3EE] text-[#525866]"
                      )}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* =============================================================== */}
            {/* TAB 1: FAVORITOS (RADAR PERSONAL)                               */}
            {/* =============================================================== */}
            {activeTab === "favoritos" ? (
              <div className="mt-5">
                {isLoadingOverview && !overview ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-64 w-full rounded-xl" />
                    ))}
                  </div>
                ) : favorites.length === 0 ? (
                  <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#D5D2C9] bg-white px-6 py-14 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FEF2EE] text-[#E64825]">
                      <Heart className="h-6 w-6" />
                    </span>
                    <h2 className="mt-3 text-base font-bold text-[#111315]">
                      Aún no tienes favoritos en tu radar
                    </h2>
                    <p className="mt-1 max-w-md text-sm text-[#525866]">
                      Pulsa el corazón ♥ en cualquier producto del catálogo para guardar su
                      precio actual y rastrear automáticamente cuándo baja en Panamá.
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <Button
                        variant="brand"
                        onClick={() => setActiveView("catalogo")}
                      >
                        Explorar catálogo
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setActiveView("ofertas")}
                      >
                        Ver mejores ofertas
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-[#525866]">
                        Comparamos el mejor precio de hoy contra el precio exacto del día
                        en que guardaste cada producto.
                      </p>

                      {droppedFavorites.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setFavFilter("all")}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                              favFilter === "all"
                                ? "border-[#111315] bg-[#111315] text-white"
                                : "border-[#E7E5DF] bg-white text-[#525866] hover:text-[#111315]"
                            )}
                          >
                            Todos ({favorites.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setFavFilter("drops")}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                              favFilter === "drops"
                                ? "border-[#059669] bg-[#059669] text-white"
                                : "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857] hover:bg-[#D1FAE5]"
                            )}
                          >
                            <TrendingDown className="h-3 w-3" />
                            Bajaron de precio ({droppedFavorites.length})
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {displayedFavorites.map((fav) => (
                        <FavoriteCard
                          key={fav.id}
                          fav={fav}
                          lists={lists}
                          onOpenProduct={openProduct}
                          onRemoveFavorite={(productId) =>
                            toggleFavorite(productId, fav.product)
                          }
                          onAddToList={(listId, productId) =>
                            addToList(listId, productId, 1)
                          }
                          onGoToListsTab={() => setActiveTab("listas")}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {/* =============================================================== */}
            {/* TAB 2: LISTAS Y PRESUPUESTOS                                    */}
            {/* =============================================================== */}
            {activeTab === "listas" ? (
              <div className="mt-5 space-y-5">
                {/* Create List Inline Form + Quick Suggestions */}
                <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
                  <div className="flex items-center gap-2">
                    <FolderPlus className="h-4 w-4 text-[#E64825]" />
                    <h2 className="text-sm font-bold text-[#111315]">
                      Nueva lista o presupuesto inteligente
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-[#525866]">
                    Agrupa productos que planeas comprar y te mostramos la combinación más
                    barata entre tiendas de Panamá.
                  </p>

                  <form
                    onSubmit={(e) => void handleCreateList(e)}
                    className="mt-3.5 grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      type="text"
                      placeholder="Nombre de la lista (ej. Mi Setup PC)"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      maxLength={80}
                    />
                    <Input
                      type="text"
                      placeholder="Nota o presupuesto objetivo (opcional)"
                      value={newListDesc}
                      onChange={(e) => setNewListDesc(e.target.value)}
                      maxLength={240}
                    />
                    <Button
                      type="submit"
                      variant="brand"
                      disabled={isCreatingList || newListName.trim().length < 2}
                    >
                      {isCreatingList && !creatingPreset ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creando...
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Crear lista
                        </>
                      )}
                    </Button>
                  </form>

                  {listError ? (
                    <p className="mt-2 text-xs font-medium text-[#DC2626]">
                      {listError}
                    </p>
                  ) : null}

                  {/* 1-click Suggestions */}
                  <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-medium text-[#666D7C]">
                      Crear en 1 clic:
                    </span>
                    {QUICK_LIST_PRESETS.map((preset) => {
                      const alreadyExists = existingListNames.has(
                        preset.name.toLowerCase()
                      );
                      const isCreatingThis = creatingPreset === preset.name;
                      return (
                        <button
                          key={preset.name}
                          type="button"
                          disabled={alreadyExists || isCreatingList}
                          onClick={() => void handleQuickPresetList(preset)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                            alreadyExists
                              ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857] cursor-default"
                              : "border-[#E7E5DF] bg-[#FAFAF7] text-[#111315] hover:border-[#E64825] hover:bg-[#FEF2EE] hover:text-[#B83416] cursor-pointer disabled:opacity-50"
                          )}
                        >
                          {isCreatingThis ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : alreadyExists ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          <span>{preset.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Lists Collection */}
                {isLoadingOverview && !overview ? (
                  <Skeleton className="h-56 w-full rounded-xl" />
                ) : lists.length === 0 ? (
                  <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#D5D2C9] bg-white px-6 py-12 text-center">
                    <ClipboardList className="h-8 w-8 text-[#666D7C]" />
                    <h3 className="mt-3 text-base font-bold text-[#111315]">
                      Crea tu primera lista de presupuesto
                    </h3>
                    <p className="mt-1 max-w-md text-sm text-[#525866]">
                      Usa cualquiera de las sugerencias rápidas de arriba (como{" "}
                      <strong>Mi Setup PC</strong> o <strong>Línea Blanca Hogar</strong>) y
                      añade productos desde el catálogo para calcular cuánto ahorras.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {lists.map((list) => (
                      <ShoppingListCard
                        key={list.id}
                        list={list}
                        onDeleteList={deleteList}
                        onRemoveItem={removeFromList}
                        onOpenProduct={openProduct}
                        onExploreCatalog={() => setActiveView("catalogo")}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* =============================================================== */}
            {/* TAB 3: ALERTAS DE PRECIO                                        */}
            {/* =============================================================== */}
            {activeTab === "alertas" ? (
              <div className="mt-5">
                {isLoadingOverview && !overview ? (
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
                      onClick={() => setActiveView("catalogo")}
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
                        onOpenProduct={openProduct}
                        onUpdateAlert={updateAlert}
                        onDeleteAlert={deleteAlert}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
