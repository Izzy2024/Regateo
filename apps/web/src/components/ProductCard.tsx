import type { ProductSummaryDTO } from "@regateo/shared";
import {
  ArrowUpRight,
  Check,
  GitCompareArrows,
  Heart,
  Layers,
  Scale,
} from "lucide-react";
import { useState } from "react";
import { useUserSpace } from "@/hooks/useUserSpace";
import { buildOutboundUrl } from "@/lib/api";
import {
  cn,
  formatUsd,
  formatUsdWhole,
  getCategoryShortLabel,
} from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CategoryIcon } from "./CategoryIcon";
import { BorderBeam } from "./magicui/border-beam";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface ProductCardProps {
  product: ProductSummaryDTO;
  featured?: boolean;
}

export function ProductCard({ product, featured = false }: ProductCardProps) {
  const openProduct = useFilterStore((s) => s.openProduct);
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);
  const compareItems = useFilterStore((s) => s.compareItems);
  const toggleCompareItem = useFilterStore((s) => s.toggleCompareItem);
  const { isFavorited, toggleFavorite } = useUserSpace();

  const [imgFailed, setImgFailed] = useState(false);
  const [showGuestNudge, setShowGuestNudge] = useState(false);

  const isFavorite = isFavorited(product.id, product.slug);
  const isComparing = compareItems.some((item) => item.id === product.id);

  const handleToggleFavorite = () => {
    const result = toggleFavorite(product.id, product);
    if (!result.isAuthenticated && result.added) {
      setShowGuestNudge(true);
      window.setTimeout(() => setShowGuestNudge(false), 3800);
    } else {
      setShowGuestNudge(false);
    }
  };

  const sortedListings = [...product.listings].sort(
    (a, b) => a.priceCents - b.priceCents
  );
  const topListings = sortedListings.slice(0, 3);
  const bestListing = sortedListings[0] ?? null;
  const bestStoreUrl = buildOutboundUrl(
    product.bestStore?.listingId ?? bestListing?.id,
    product.bestStore?.url ?? bestListing?.url,
    "card"
  );
  // Ahorro real entre tiendas: exige 2+ tiendas y un porcentaje creíble (nunca >99%)
  const hasCrossStoreSavings =
    product.storeCount >= 2 &&
    product.savingsCents > 0 &&
    product.savingsPercent <= 99;
  // Descuento anunciado por la tienda ganadora sobre su propio precio "antes" (tope 65%)
  const hasStoreDiscount =
    product.storeCount <= 1 &&
    (product.storeDiscountCents ?? 0) > 0 &&
    (product.storeDiscountPercent ?? 0) > 0 &&
    (product.storeDiscountPercent ?? 0) <= 65;
  const isOutOfStock = product.inStockCount === 0;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-white card-elevation transition-[border-color,box-shadow] duration-150 hover:card-elevation-hover",
        featured
          ? "border-[#E64825]/35 hover:border-[#E64825]/55"
          : "border-[#E7E5DF] hover:border-[#D5D2C9]"
      )}
    >
      {featured ? (
        <BorderBeam colorFrom="#E64825" colorTo="#059669" duration={8} borderWidth={1.5} />
      ) : null}
      <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden border-b border-[#EFECE5] bg-[#F7F6F2] p-4">
        <button
          type="button"
          onClick={() => openProduct(product.slug)}
          className="flex h-full w-full items-center justify-center cursor-pointer"
          aria-label={`Ver comparación detallada de ${product.canonicalName}`}
        >
          {product.imageUrl && !imgFailed ? (
            <img
              src={product.imageUrl}
              alt={product.canonicalName}
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className="max-h-full max-w-full object-contain mix-blend-multiply"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-[#666D7C]">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#E7E5DF] bg-white">
                <CategoryIcon category={product.category} className="h-6 w-6" />
              </div>
              <span className="text-[11px] font-medium">
                {getCategoryShortLabel(product.category)}
              </span>
            </div>
          )}
        </button>

        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {featured ? (
            <Badge className="border-[#111315] bg-[#111315] text-white">
              #1 Oferta
            </Badge>
          ) : null}
          {isOutOfStock ? (
            <Badge variant="muted">Agotado</Badge>
          ) : hasCrossStoreSavings ? (
            <Badge variant="savings" className="font-mono tabular-nums">
              Ahorras {formatUsdWhole(product.savingsCents)} (-
              {product.savingsPercent}%) entre tiendas
            </Badge>
          ) : product.storeCount >= 2 ? (
            <Badge variant="default" className="bg-white/95">
              <Layers className="h-3 w-3 text-[#059669]" />
              {product.storeCount} tiendas
            </Badge>
          ) : hasStoreDiscount ? (
            <Badge variant="default" className="bg-white/95">
              Dto. tienda -{product.storeDiscountPercent}%
            </Badge>
          ) : null}
        </div>

        <div className="absolute right-2.5 top-2.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleCompareItem(product)}
            aria-label={
              isComparing
                ? `Quitar ${product.canonicalName} del comparador`
                : `Agregar ${product.canonicalName} al comparador`
            }
            title={isComparing ? "En comparador" : "Comparar lado a lado"}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors cursor-pointer",
              isComparing
                ? "border-[#111315] bg-[#111315] text-white"
                : "border-[#E7E5DF] bg-white/95 text-[#525866] hover:border-[#D5D2C9] hover:text-[#111315]"
            )}
          >
            {isComparing ? (
              <Check className="h-3 w-3" strokeWidth={2.5} />
            ) : (
              <Scale className="h-3 w-3" strokeWidth={2} />
            )}
            <span className="hidden sm:inline">{isComparing ? "Listo" : "Comparar"}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleFavorite}
            aria-label={
              isFavorite ? "Quitar de guardados" : "Guardar producto"
            }
            title={isFavorite ? "Guardado" : "Guardar"}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors cursor-pointer",
              isFavorite
                ? "border-[#FBCFC3] bg-[#FEF2EE] text-[#E64825]"
                : "border-[#E7E5DF] bg-white/95 text-[#525866] hover:border-[#D5D2C9] hover:text-[#111315]"
            )}
          >
            <Heart
              className="h-3.5 w-3.5"
              fill={isFavorite ? "currentColor" : "none"}
              strokeWidth={2}
            />
          </button>
        </div>

        {showGuestNudge ? (
          <div className="absolute bottom-2.5 left-2.5 right-2.5 z-10 flex items-center justify-between gap-2 rounded-lg border border-[#E7E5DF] bg-white/96 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-xs">
            <span className="truncate font-medium text-[#525866]">
              Guardado localmente
            </span>
            <button
              type="button"
              onClick={() =>
                setAuthOpen(true, {
                  mode: "signup",
                  hint: "Crea tu cuenta gratis para sincronizar tus favoritos y detectar bajadas de precio.",
                })
              }
              className="shrink-0 font-bold text-[#E64825] hover:underline cursor-pointer"
            >
              Guardar en cuenta →
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-[#666D7C]">
          <span className="truncate font-semibold text-[#525866]">
            {product.brand || getCategoryShortLabel(product.category)}
          </span>
          {product.modelNumber ? (
            <span className="shrink-0 truncate rounded bg-[#F4F3EE] px-1.5 py-0.5 font-mono text-[10px] text-[#525866]">
              {product.modelNumber}
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => openProduct(product.slug)}
          className="mt-1.5 line-clamp-2 text-left text-[15px] leading-[1.32] font-bold tracking-[-0.015em] text-[#111315] transition-colors hover:text-[#E64825] cursor-pointer"
        >
          {product.canonicalName}
        </button>

        <div
          className={cn(
            "mt-3.5 rounded-lg border p-3",
            isOutOfStock
              ? "border-[#D5D2C9] bg-[#F4F3EE]"
              : "border-[#A7F3D0] bg-[#ECFDF5]"
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <span className="block text-[11px] font-semibold text-[#047857]">
                {isOutOfStock ? "Agotado · último precio" : "Mejor precio verificado"}
              </span>
              <span
                className={cn(
                  "font-price text-[22px] leading-tight font-bold",
                  isOutOfStock ? "text-[#525866]" : "text-[#047857]"
                )}
              >
                {formatUsd(product.bestPriceCents)}
              </span>
            </div>

            {product.bestStore ? (
              <span
                className="inline-flex max-w-[130px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold"
                style={{
                  backgroundColor: bestListing?.storeAccentBg || "#FFFFFF",
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

          {hasCrossStoreSavings &&
          product.highestPriceCents > product.bestPriceCents ? (
            <p className="mt-1.5 text-[11px] text-[#065F46]">
              Hasta{" "}
              <span className="font-price font-semibold">
                {formatUsd(product.highestPriceCents)}
              </span>{" "}
              en otra tienda · Ahorras{" "}
              <span className="font-price font-semibold">
                {formatUsd(product.savingsCents)}
              </span>
            </p>
          ) : (
            <p
              className={cn(
                "mt-1 text-[11px]",
                isOutOfStock ? "text-[#666D7C]" : "text-[#065F46]"
              )}
            >
              {isOutOfStock
                ? "Sin stock en el último barrido"
                : "Disponible en tienda"}
            </p>
          )}
        </div>

        {topListings.length > 0 ? (
          <div className="mt-3 divide-y divide-[#EFECE5] border-t border-b border-[#EFECE5]">
            {topListings.map((listing) => {
              const safeUrl = buildOutboundUrl(listing.id, listing.url, "card");
              return (
                <div
                  key={listing.id}
                  className="flex items-center justify-between gap-2 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: listing.storeColor }}
                    />
                    <span className="truncate font-medium text-[#111315]">
                      {listing.storeName}
                    </span>
                    {!listing.inStock ? (
                      <span className="shrink-0 rounded bg-[#F4F3EE] px-1 text-[10px] text-[#666D7C]">
                        Agotado
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "font-price text-xs font-semibold",
                        listing.isCheapest ? "text-[#047857]" : "text-[#525866]"
                      )}
                    >
                      {formatUsd(listing.priceCents)}
                    </span>
                    {safeUrl ? (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Verificar en ${listing.storeName}`}
                        aria-label={`Abrir producto en ${listing.storeName}`}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#666D7C] transition-colors hover:bg-[#F4F3EE] hover:text-[#111315]"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {product.listings.length > 3 ? (
              <button
                type="button"
                onClick={() => openProduct(product.slug)}
                className="w-full py-1.5 text-left text-[11px] font-semibold text-[#525866] hover:text-[#E64825] cursor-pointer"
              >
                + Ver {product.listings.length - 3} tiendas más
              </button>
            ) : null}
          </div>
        ) : null}

        {product.storeCount <= 1 ? (
          <button
            type="button"
            onClick={() => openProduct(product.slug)}
            className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-[#D5D2C9] bg-[#FAFAF7] px-2.5 py-1.5 text-left text-[11px] font-semibold text-[#525866] transition-colors hover:border-[#E64825]/50 hover:bg-[#FEF2EE]/75 hover:text-[#B83416] cursor-pointer"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <GitCompareArrows className="h-3 w-3 shrink-0 text-[#E64825]" />
              <span className="truncate">Ver similares en otras tiendas</span>
            </span>
            <span className="shrink-0 font-mono text-[10px] text-[#666D7C]">→</span>
          </button>
        ) : null}

        <div className="mt-auto grid grid-cols-2 gap-2 pt-3.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openProduct(product.slug)}
            className="w-full gap-1.5 px-2.5 text-xs"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            <span>Comparar</span>
          </Button>

          {bestStoreUrl && product.bestStore ? (
            <a
              href={bestStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-[#111315] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#E64825]"
            >
              <span className="truncate">Ir a {product.bestStore.name}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openProduct(product.slug)}
              className="w-full text-xs"
            >
              Ver detalle
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
