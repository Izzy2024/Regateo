import type {
  FavoriteProductDTO,
  ProductSummaryDTO,
  ShoppingListDTO,
} from "@regateo/shared";
import {
  ArrowUpRight,
  Check,
  FolderPlus,
  GitCompareArrows,
  Heart,
  ListPlus,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { buildOutboundUrl } from "@/lib/api";
import { cn, formatUsd, getCategoryShortLabel } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductThumb } from "./ProductThumb";

type FavFilter = "all" | "drops";

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
  onRemoveFavorite: (productId: string, product: ProductSummaryDTO) => void;
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
  const bestStoreUrl = buildOutboundUrl(
    product.bestStore?.listingId,
    product.bestStore?.url,
    "account"
  );

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
              onClick={() => onRemoveFavorite(fav.productId, product)}
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

export function FavoritesTab({
  favorites,
  lists,
  isLoading,
  onOpenProduct,
  onRemoveFavorite,
  onAddToList,
  onGoToCatalog,
  onGoToDeals,
  onGoToListsTab,
}: {
  favorites: FavoriteProductDTO[];
  lists: ShoppingListDTO[];
  isLoading: boolean;
  onOpenProduct: (slug: string) => void;
  onRemoveFavorite: (productId: string, product: ProductSummaryDTO) => void;
  onAddToList: (listId: string, productId: string) => Promise<unknown>;
  onGoToCatalog: () => void;
  onGoToDeals: () => void;
  onGoToListsTab: () => void;
}) {
  const [favFilter, setFavFilter] = useState<FavFilter>("all");

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

  return (
    <div className="mt-5">
      {isLoading ? (
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
            <Button variant="brand" onClick={onGoToCatalog}>
              Explorar catálogo
            </Button>
            <Button variant="outline" onClick={onGoToDeals}>
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
                onOpenProduct={onOpenProduct}
                onRemoveFavorite={onRemoveFavorite}
                onAddToList={onAddToList}
                onGoToListsTab={onGoToListsTab}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
