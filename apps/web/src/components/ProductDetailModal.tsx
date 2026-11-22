import type { ReportWrongPriceInput, SimilarProductDTO } from "@regateo/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Flag,
  GitCompareArrows,
  Heart,
  ListPlus,
  Loader2,
  Plus,
  Scale,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useUserSpace } from "@/hooks/useUserSpace";
import {
  buildOutboundUrl,
  fetchProductBySlug,
  fetchSimilarProducts,
  reportWrongPrice,
} from "@/lib/api";
import {
  cn,
  formatRelativeEs,
  formatUsd,
  getCategoryLabel,
  getCategoryShortLabel,
  getDomainLabel,
} from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CategoryIcon } from "./CategoryIcon";
import { BorderBeam } from "./magicui/border-beam";
import { PriceAlertForm } from "./PriceAlertForm";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Skeleton } from "./ui/skeleton";

type SimilarFilter = "all" | "cheaper" | "other-stores";

const REPORT_REASONS: Array<{
  value: ReportWrongPriceInput["reason"];
  label: string;
}> = [
  { value: "wrong-price", label: "Precio distinto en la tienda" },
  { value: "out-of-stock", label: "Está agotado" },
  { value: "wrong-match", label: "No es el mismo modelo" },
  { value: "broken-link", label: "Enlace roto" },
];

function SimilarProductThumb({
  imageUrl,
  alt,
  category,
}: {
  imageUrl: string | null;
  alt: string;
  category: SimilarProductDTO["category"];
}) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-[#E7E5DF] bg-[#F7F6F2] text-[#666D7C]">
        <CategoryIcon category={category} className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E7E5DF] bg-[#F7F6F2] p-1.5">
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

export function ProductDetailModal() {
  const selectedSlug = useFilterStore((s) => s.selectedProductSlug);
  const openProduct = useFilterStore((s) => s.openProduct);
  const closeProduct = useFilterStore((s) => s.closeProduct);
  const compareItems = useFilterStore((s) => s.compareItems);
  const toggleCompareItem = useFilterStore((s) => s.toggleCompareItem);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);

  const {
    isAuthenticated,
    isFavorited,
    toggleFavorite,
    lists,
    addToList,
    removeFromList,
    createList,
    isCreatingList,
  } = useUserSpace();

  const [copied, setCopied] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [similarFilter, setSimilarFilter] = useState<SimilarFilter>("all");
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [quickListName, setQuickListName] = useState("");
  const [listBusyId, setListBusyId] = useState<string | null>(null);
  const [listFeedback, setListFeedback] = useState<string | null>(null);
  const [reportListingId, setReportListingId] = useState<string | null>(null);
  const [reportedListingIds, setReportedListingIds] = useState<string[]>([]);
  const listMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImgFailed(false);
    setSimilarFilter("all");
    setListMenuOpen(false);
    setListFeedback(null);
    setReportListingId(null);
    setReportedListingIds([]);
  }, [selectedSlug]);

  useEffect(() => {
    if (!listMenuOpen) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (
        listMenuRef.current &&
        !listMenuRef.current.contains(event.target as Node)
      ) {
        setListMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [listMenuOpen]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["product-detail", selectedSlug],
    queryFn: () => fetchProductBySlug(selectedSlug!),
    enabled: Boolean(selectedSlug),
  });

  const product = data?.product;
  const shouldFetchSimilarLazy = Boolean(
    selectedSlug && product && product.similarProducts === undefined
  );

  const reportMutation = useMutation({
    mutationFn: reportWrongPrice,
    onSuccess: (_result, variables) => {
      setReportedListingIds((prev) =>
        prev.includes(variables.listingId)
          ? prev
          : [...prev, variables.listingId]
      );
    },
  });

  const handleReport = (
    listingId: string,
    reason: ReportWrongPriceInput["reason"]
  ) => {
    if (!product) return;
    reportMutation.mutate({ productId: product.id, listingId, reason });
  };

  const similarQuery = useQuery({
    queryKey: ["product-similar", selectedSlug],
    queryFn: () => fetchSimilarProducts(selectedSlug!, 8),
    enabled: shouldFetchSimilarLazy,
    staleTime: 60_000,
  });

  const similarProducts: SimilarProductDTO[] = useMemo(() => {
    if (product?.similarProducts !== undefined) {
      return product.similarProducts;
    }
    return similarQuery.data?.items ?? [];
  }, [product?.similarProducts, similarQuery.data?.items]);

  const currentStoreSlugs = useMemo(
    () => new Set((product?.listings ?? []).map((item) => item.storeSlug)),
    [product?.listings]
  );

  const cheaperCount = useMemo(
    () => similarProducts.filter((item) => item.priceDiffCents < 0).length,
    [similarProducts]
  );

  const otherStoresCount = useMemo(
    () =>
      similarProducts.filter(
        (item) => !currentStoreSlugs.has(item.bestStore.slug)
      ).length,
    [similarProducts, currentStoreSlugs]
  );

  const filteredSimilarProducts = useMemo(() => {
    if (similarFilter === "cheaper") {
      return similarProducts.filter((item) => item.priceDiffCents < 0);
    }
    if (similarFilter === "other-stores") {
      return similarProducts.filter(
        (item) => !currentStoreSlugs.has(item.bestStore.slug)
      );
    }
    return similarProducts;
  }, [similarProducts, similarFilter, currentStoreSlugs]);

  const isFavorite = product ? isFavorited(product.id, product.slug) : false;
  const isComparing = product
    ? compareItems.some((item) => item.id === product.id)
    : false;
  const inListsCount = useMemo(() => {
    if (!product || !isAuthenticated) return 0;
    return lists.filter((list) =>
      list.items.some((item) => item.productId === product.id)
    ).length;
  }, [lists, product, isAuthenticated]);

  const handleOpenListSelector = () => {
    if (!isAuthenticated) {
      setAuthOpen(true, {
        mode: "signup",
        hint: "Las listas de compra y presupuestos inteligentes se guardan en tu cuenta gratis de RegateoApp.",
      });
      return;
    }
    setListFeedback(null);
    setListMenuOpen((prev) => !prev);
  };

  const handleToggleInList = async (listId: string, alreadyIn: boolean) => {
    if (!product) return;
    setListBusyId(listId);
    setListFeedback(null);
    try {
      if (alreadyIn) {
        await removeFromList(listId, product.id);
      } else {
        await addToList(listId, product.id, 1);
      }
    } finally {
      setListBusyId(null);
    }
  };

  const handleQuickCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    const trimmed = quickListName.trim();
    if (trimmed.length < 2) return;
    setListFeedback(null);
    try {
      const created = await createList({ name: trimmed });
      if (created?.list?.id) {
        await addToList(created.list.id, product.id, 1);
        setListFeedback(`Añadido a "${trimmed}"`);
      }
      setQuickListName("");
    } catch (err) {
      setListFeedback(
        err instanceof Error ? err.message : "No se pudo crear la lista."
      );
    }
  };

  const handleCopyShareUrl = async () => {
    if (!selectedSlug) return;
    const url = new URL(window.location.href);
    url.searchParams.set("producto", selectedSlug);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const sortedListings = product
    ? [...product.listings].sort((a, b) => a.priceCents - b.priceCents)
    : [];

  const bestStoreOutUrl = product?.bestStore
    ? buildOutboundUrl(
        product.bestStore.listingId,
        product.bestStore.url,
        "detail"
      )
    : null;

  return (
    <Dialog
      open={Boolean(selectedSlug)}
      onClose={closeProduct}
      maxWidthClass="max-w-5xl"
      title={product ? product.canonicalName : "Comparación de precios"}
      description={
        product
          ? `${product.brand ? `${product.brand} · ` : ""}${getCategoryLabel(product.category)}${
              product.modelNumber ? ` · Modelo ${product.modelNumber}` : ""
            }`
          : undefined
      }
    >
      <div className="p-5 sm:p-6">
        {isLoading ? (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <Skeleton className="h-52 w-full rounded-xl" />
              <div className="space-y-3">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
        ) : isError || !product ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-8 w-8 text-[#E64825]" />
            <h3 className="mt-3 text-base font-bold text-[#111315]">
              No pudimos cargar el detalle de este producto
            </h3>
            <p className="mt-1 max-w-md text-sm text-[#525866]">
              {error instanceof Error
                ? error.message
                : "Verifica que el servidor API esté activo e intenta de nuevo."}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => refetch()}>
                Reintentar
              </Button>
              <Button variant="primary" onClick={closeProduct}>
                Volver al catálogo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-[230px_1fr]">
              <div className="flex aspect-square items-center justify-center rounded-xl border border-[#E7E5DF] bg-[#F7F6F2] p-4">
                {product.imageUrl && !imgFailed ? (
                  <img
                    src={product.imageUrl}
                    alt={product.canonicalName}
                    onError={() => setImgFailed(true)}
                    className="max-h-full max-w-full object-contain mix-blend-multiply"
                  />
                ) : (
                  <CategoryIcon
                    category={product.category}
                    className="h-12 w-12 text-[#666D7C]"
                  />
                )}
              </div>

              <div className="flex flex-col justify-between gap-4">
                <div className="relative overflow-hidden rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-4">
                  <BorderBeam
                    colorFrom="#E64825"
                    colorTo="#059669"
                    duration={7.5}
                    borderWidth={1.5}
                  />
                  <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold text-[#047857]">
                        {product.inStockCount === 0
                          ? "Último precio detectado · agotado al último barrido"
                          : "Mejor precio detectado en Panamá"}
                      </span>
                      <div className="mt-0.5 flex items-baseline gap-2.5">
                        <span className="font-price text-3xl font-bold text-[#047857]">
                          {formatUsd(product.bestPriceCents)}
                        </span>
                        {product.storeCount >= 2 &&
                        product.savingsCents > 0 &&
                        product.savingsPercent <= 99 ? (
                          <Badge variant="savings" className="font-mono tabular-nums">
                            Ahorras {formatUsd(product.savingsCents)} (-
                            {product.savingsPercent}%) entre tiendas
                          </Badge>
                        ) : null}
                        {product.storeCount <= 1 &&
                        (product.storeDiscountCents ?? 0) > 0 &&
                        (product.storeDiscountPercent ?? 0) > 0 &&
                        (product.storeDiscountPercent ?? 0) <= 65 ? (
                          <Badge
                            variant="savingsSoft"
                            className="font-mono tabular-nums"
                          >
                            Dto. tienda -{product.storeDiscountPercent}%
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-[#065F46]">
                        Comparado en{" "}
                        <strong className="font-semibold">
                          {product.storeCount}{" "}
                          {product.storeCount === 1 ? "tienda" : "tiendas"}
                        </strong>
                        {product.highestPriceCents > product.bestPriceCents
                          ? ` · Precio más alto registrado: ${formatUsd(
                              product.highestPriceCents
                            )}`
                          : ""}
                      </p>
                    </div>

                    {product.bestStore && bestStoreOutUrl ? (
                      <a
                        href={bestStoreOutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#047857] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#065F46]"
                      >
                        <span>Comprar en {product.bestStore.name}</span>
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={isComparing ? "primary" : "outline"}
                    size="sm"
                    onClick={() => toggleCompareItem(product)}
                  >
                    {isComparing ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Scale className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {isComparing ? "En comparador rápido" : "Agregar al comparador"}
                    </span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleFavorite(product.id, product)}
                  >
                    <Heart
                      className={cn(
                        "h-3.5 w-3.5",
                        isFavorite ? "text-[#E64825]" : ""
                      )}
                      fill={isFavorite ? "currentColor" : "none"}
                    />
                    <span>{isFavorite ? "Guardado" : "Guardar"}</span>
                  </Button>

                  <div ref={listMenuRef} className="relative">
                    <Button
                      variant={inListsCount > 0 ? "secondary" : "outline"}
                      size="sm"
                      onClick={handleOpenListSelector}
                    >
                      <ListPlus
                        className={cn(
                          "h-3.5 w-3.5",
                          inListsCount > 0 ? "text-[#059669]" : ""
                        )}
                      />
                      <span>
                        {inListsCount > 0
                          ? `En ${inListsCount} ${inListsCount === 1 ? "lista" : "listas"}`
                          : "Guardar en lista"}
                      </span>
                    </Button>

                    {listMenuOpen && isAuthenticated ? (
                      <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-[#E7E5DF] bg-white p-3 shadow-xl">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-bold text-[#111315]">
                            Guardar en lista de presupuesto
                          </span>
                          <button
                            type="button"
                            onClick={() => setListMenuOpen(false)}
                            aria-label="Cerrar selector de listas"
                            className="rounded p-0.5 text-[#666D7C] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {lists.length > 0 ? (
                          <div className="max-h-44 space-y-1 overflow-y-auto">
                            {lists.map((list) => {
                              const alreadyIn = list.items.some(
                                (i) => i.productId === product.id
                              );
                              const busy = listBusyId === list.id;
                              return (
                                <button
                                  key={list.id}
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleToggleInList(list.id, alreadyIn)
                                  }
                                  className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60",
                                    alreadyIn
                                      ? "bg-[#ECFDF5] text-[#047857]"
                                      : "text-[#111315] hover:bg-[#F4F3EE]"
                                  )}
                                >
                                  <span className="truncate">{list.name}</span>
                                  {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  ) : alreadyIn ? (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-[#059669]" />
                                  ) : (
                                    <Plus className="h-3.5 w-3.5 shrink-0 text-[#666D7C]" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="rounded-lg bg-[#FAFAF7] px-2.5 py-2 text-[11px] text-[#525866]">
                            Aún no tienes listas. Crea una en 1 paso aquí abajo:
                          </p>
                        )}

                        <form
                          onSubmit={(e) => void handleQuickCreateAndAdd(e)}
                          className="mt-2.5 flex items-center gap-1.5 border-t border-[#EFECE5] pt-2.5"
                        >
                          <input
                            type="text"
                            value={quickListName}
                            onChange={(e) => setQuickListName(e.target.value)}
                            placeholder="Nueva lista (ej. Mi Setup)"
                            maxLength={80}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-[#E7E5DF] bg-[#FAFAF7] px-2.5 text-xs text-[#111315] placeholder:text-[#666D7C] focus:border-[#E64825] focus:bg-white focus:outline-none"
                          />
                          <Button
                            type="submit"
                            variant="brand"
                            size="xs"
                            disabled={
                              isCreatingList || quickListName.trim().length < 2
                            }
                          >
                            {isCreatingList ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </form>

                        {listFeedback ? (
                          <p className="mt-1.5 text-[11px] font-semibold text-[#047857]">
                            {listFeedback}
                          </p>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => {
                            setListMenuOpen(false);
                            closeProduct();
                            setActiveView("mi-espacio");
                          }}
                          className="mt-2 block w-full text-center text-[11px] font-semibold text-[#525866] hover:text-[#E64825] cursor-pointer"
                        >
                          Administrar listas en Mi Espacio →
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <Button variant="outline" size="sm" onClick={handleCopyShareUrl}>
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-[#059669]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{copied ? "Enlace copiado" : "Compartir"}</span>
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      closeProduct();
                      setAiOpen(
                        true,
                        `Analiza si conviene comprar "${product.canonicalName}" a ${formatUsd(
                          product.bestPriceCents
                        )} o si hay una alternativa mejor en Panamá.`
                      );
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#E64825]" />
                    <span>Consultar a Regateo AI</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Exact store price matrix */}
            <div>
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
                  Matriz de precios por tienda ({sortedListings.length})
                </h3>
                <span className="text-xs text-[#666D7C]">
                  Ordenado de menor a mayor precio en USD
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#E7E5DF]">
                <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E7E5DF] bg-[#FAFAF7] text-[11px] font-bold tracking-[0.02em] text-[#525866] uppercase">
                      <th className="px-4 py-2.5">Tienda</th>
                      <th className="px-4 py-2.5">Precio actual</th>
                      <th className="px-4 py-2.5">Diferencia</th>
                      <th className="px-4 py-2.5">Disponibilidad</th>
                      <th className="px-4 py-2.5">Verificado</th>
                      <th className="px-4 py-2.5 text-right">Enlace</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFECE5] bg-white">
                    {sortedListings.map((listing) => {
                      const safeUrl = buildOutboundUrl(listing.id, listing.url, "detail");
                      return (
                        <Fragment key={listing.id}>
                          <tr
                            className={cn(
                              "transition-colors hover:bg-[#FAFAF7]",
                              listing.isCheapest && listing.inStock
                                ? "bg-[#ECFDF5]/40"
                                : "",
                              listing.inStock ? "" : "opacity-60"
                            )}
                          >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                                style={{
                                  backgroundColor: listing.storeAccentBg,
                                  color: listing.storeColor,
                                }}
                              >
                                {listing.storeName.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <div className="font-semibold text-[#111315]">
                                  {listing.storeName}
                                </div>
                                <div className="max-w-[230px] truncate text-xs text-[#666D7C]">
                                  {listing.titleAtStore || getDomainLabel(listing.url)}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-price text-[15px] font-bold text-[#111315]">
                              {formatUsd(listing.priceCents)}
                            </div>
                            {listing.originalPriceCents &&
                            listing.originalPriceCents > listing.priceCents ? (
                              <div className="font-price text-xs text-[#666D7C] line-through">
                                {formatUsd(listing.originalPriceCents)}
                              </div>
                            ) : null}
                          </td>

                          <td className="px-4 py-3">
                            {listing.isCheapest ? (
                              <Badge variant="best">Mejor precio</Badge>
                            ) : (
                              <span className="font-price text-xs font-semibold text-[#B83416]">
                                +{formatUsd(listing.deltaFromCheapestCents)}
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            {listing.inStock ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#047857]">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                En stock
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#666D7C]">
                                <XCircle className="h-3.5 w-3.5" />
                                Agotado
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-xs text-[#525866]">
                            Verificado {formatRelativeEs(listing.lastCheckedAt)} en{" "}
                            {listing.storeName}
                          </td>

                          <td className="px-4 py-3 text-right">
                            {safeUrl ? (
                              <a
                                href={safeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                                  listing.isCheapest
                                    ? "bg-[#111315] text-white hover:bg-[#E64825]"
                                    : "border border-[#E7E5DF] bg-white text-[#111315] hover:bg-[#F4F3EE]"
                                )}
                              >
                                <span>Verificar</span>
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </a>
                            ) : (
                              <span className="text-xs text-[#666D7C]">No disponible</span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setReportListingId((prev) =>
                                  prev === listing.id ? null : listing.id
                                )
                              }
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#666D7C] transition-colors hover:text-[#B83416] cursor-pointer"
                            >
                              <Flag className="h-3 w-3" />
                              <span>Reportar</span>
                            </button>
                          </td>
                        </tr>
                          {reportListingId === listing.id ? (
                            <tr>
                              <td colSpan={6} className="bg-[#FAFAF7] px-4 py-2.5">
                                {reportedListingIds.includes(listing.id) ? (
                                  <p className="text-[11px] font-semibold text-[#047857]">
                                    Gracias, lo revisaremos en el próximo barrido.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] font-semibold text-[#525866]">
                                      ¿Precio o stock incorrecto en {listing.storeName}?
                                      Repórtalo:
                                    </span>
                                    {REPORT_REASONS.map((reason) => (
                                      <button
                                        key={reason.value}
                                        type="button"
                                        disabled={reportMutation.isPending}
                                        onClick={() =>
                                          handleReport(listing.id, reason.value)
                                        }
                                        className="rounded-full border border-[#E7E5DF] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#525866] transition-colors hover:border-[#E64825]/50 hover:text-[#B83416] cursor-pointer disabled:opacity-60"
                                      >
                                        {reason.label}
                                      </button>
                                    ))}
                                    {reportMutation.isError ? (
                                      <span className="text-[11px] font-medium text-[#DC2626]">
                                        No pudimos enviar el reporte. Intenta de nuevo.
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Star feature: Similar products across other Panama stores */}
            <section className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <GitCompareArrows className="h-4 w-4 text-[#E64825]" strokeWidth={2.2} />
                    <h3 className="text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
                      Alternativas similares en otras tiendas de Panamá
                    </h3>
                  </div>
                  <p className="mt-0.5 text-xs text-[#525866]">
                    Modelos equivalentes por categoría, marca, especificaciones o rango de
                    precio para comparar antes de comprar.
                  </p>
                </div>

                {similarProducts.length > 0 ? (
                  <div
                    role="tablist"
                    aria-label="Filtrar alternativas similares"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {(
                      [
                        { id: "all", label: "Todos", count: similarProducts.length },
                        { id: "cheaper", label: "Más baratos", count: cheaperCount },
                        {
                          id: "other-stores",
                          label: "Otras tiendas",
                          count: otherStoresCount,
                        },
                      ] as Array<{ id: SimilarFilter; label: string; count: number }>
                    ).map((tab) => {
                      const active = similarFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setSimilarFilter(tab.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                            active
                              ? "border-[#111315] bg-[#111315] text-white"
                              : "border-[#E7E5DF] bg-white text-[#525866] hover:border-[#D5D2C9] hover:text-[#111315]"
                          )}
                        >
                          {tab.label}{" "}
                          <span
                            className={cn(
                              "ml-0.5 font-mono text-[11px] tabular-nums",
                              active ? "text-white/80" : "text-[#666D7C]"
                            )}
                          >
                            ({tab.count})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                {similarQuery.isLoading && similarProducts.length === 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, idx) => (
                      <div
                        key={idx}
                        className="flex gap-3 rounded-xl border border-[#E7E5DF] bg-white p-3.5"
                      >
                        <Skeleton className="h-16 w-16 shrink-0 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                          <Skeleton className="h-7 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : similarProducts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#D5D2C9] bg-white px-4 py-6 text-center">
                    <p className="text-xs font-medium text-[#525866]">
                      Aún no detectamos alternativas equivalentes para este modelo en
                      otras tiendas.
                    </p>
                  </div>
                ) : filteredSimilarProducts.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[#D5D2C9] bg-white px-4 py-4">
                    <p className="text-xs text-[#525866]">
                      No hay alternativas que coincidan con este filtro.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSimilarFilter("all")}
                    >
                      Ver todos ({similarProducts.length})
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredSimilarProducts.map((item) => {
                      const safeUrl = buildOutboundUrl(
                        undefined,
                        item.bestStore.url,
                        "similar"
                      );
                      const isCheaper = item.priceDiffCents < 0;
                      const isSamePrice = item.priceDiffCents === 0;

                      return (
                        <article
                          key={item.id}
                          className="flex flex-col justify-between gap-3 rounded-xl border border-[#E7E5DF] bg-white p-3.5 transition-colors hover:border-[#D5D2C9]"
                        >
                          <div className="flex gap-3">
                            <SimilarProductThumb
                              imageUrl={item.imageUrl}
                              alt={item.canonicalName}
                              category={item.category}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="truncate text-[11px] font-semibold text-[#525866]">
                                  {item.brand || getCategoryShortLabel(item.category)}
                                </span>
                                <span
                                  className="inline-flex max-w-[140px] items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold"
                                  style={{
                                    backgroundColor:
                                      item.bestStore.accentBg || "#FFFFFF",
                                    borderColor: `${item.bestStore.color}33`,
                                    color: item.bestStore.color,
                                  }}
                                >
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: item.bestStore.color }}
                                  />
                                  <span className="truncate">{item.bestStore.name}</span>
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => openProduct(item.slug)}
                                className="mt-1 line-clamp-2 text-left text-[13px] leading-snug font-bold text-[#111315] transition-colors hover:text-[#E64825] cursor-pointer"
                              >
                                {item.canonicalName}
                              </button>

                              {item.matchReasons.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {item.matchReasons.slice(0, 3).map((reason) => (
                                    <span
                                      key={reason}
                                      className="rounded-md border border-[#E7E5DF] bg-[#FAFAF7] px-1.5 py-0.5 text-[10px] font-medium text-[#525866]"
                                    >
                                      {reason}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE5] pt-2.5">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-price text-base font-bold text-[#111315]">
                                {formatUsd(item.bestPriceCents)}
                              </span>
                              {isCheaper ? (
                                <span className="inline-flex items-center rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-[#059669]">
                                  -{formatUsd(Math.abs(item.priceDiffCents))} más barato
                                </span>
                              ) : isSamePrice ? (
                                <span className="inline-flex items-center rounded-md bg-[#F4F3EE] px-1.5 py-0.5 text-[11px] font-semibold text-[#525866]">
                                  Mismo precio
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md bg-[#F4F3EE] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-[#525866]">
                                  +{formatUsd(item.priceDiffCents)}
                                </span>
                              )}
                              {!item.bestStore.inStock ? (
                                <span className="text-[10px] font-medium text-[#666D7C]">
                                  · Agotado
                                </span>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openProduct(item.slug)}
                                className="h-7 px-2.5 text-[11px]"
                              >
                                Comparar este
                              </Button>
                              {safeUrl ? (
                                <a
                                  href={safeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#111315] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#E64825]"
                                >
                                  <span className="max-w-[96px] truncate">
                                    Ir a {item.bestStore.name}
                                  </span>
                                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <PriceHistoryChart history={product.priceHistory} />

            <PriceAlertForm
              productId={product.id}
              currentBestPriceCents={product.bestPriceCents}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
