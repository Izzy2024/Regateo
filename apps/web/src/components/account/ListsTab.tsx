import type { CreateShoppingListInput, ShoppingListDTO } from "@regateo/shared";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ClipboardList,
  FolderPlus,
  Loader2,
  Plus,
  Store,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useMemo, useState } from "react";
import { buildOutboundUrl } from "@/lib/api";
import { cn, formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductThumb } from "./ProductThumb";

const QUICK_LIST_PRESETS = [
  { name: "Mi Setup PC", description: "Laptop, monitor, periféricos y accesorios" },
  { name: "Línea Blanca Hogar", description: "Lavadora, nevera, aire y cocina" },
  { name: "Upgrade Gaming", description: "Consola, audífonos, monitor y mouse" },
  { name: "Regalos", description: "Ideas seleccionadas para comparar precios" },
];

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
            const safeUrl = buildOutboundUrl(
              item.product.bestStore?.listingId,
              item.product.bestStore?.url,
              "account"
            );
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

export function ListsTab({
  lists,
  isLoading,
  isCreatingList,
  onCreateList,
  onDeleteList,
  onRemoveItem,
  onOpenProduct,
  onExploreCatalog,
}: {
  lists: ShoppingListDTO[];
  isLoading: boolean;
  isCreatingList: boolean;
  onCreateList: (input: CreateShoppingListInput) => Promise<unknown>;
  onDeleteList: (listId: string) => Promise<unknown>;
  onRemoveItem: (listId: string, productId: string) => Promise<unknown>;
  onOpenProduct: (slug: string) => void;
  onExploreCatalog: () => void;
}) {
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [creatingPreset, setCreatingPreset] = useState<string | null>(null);

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
      await onCreateList({
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
      await onCreateList({
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

  return (
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
      {isLoading ? (
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
              onDeleteList={onDeleteList}
              onRemoveItem={onRemoveItem}
              onOpenProduct={onOpenProduct}
              onExploreCatalog={onExploreCatalog}
            />
          ))}
        </div>
      )}
    </div>
  );
}
