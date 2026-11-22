import type { BuyingGuideDTO, ProductSummaryDTO } from "@regateo/shared";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Layers,
  TrendingDown,
} from "lucide-react";
import { useMemo } from "react";
import { buildOutboundUrl, fetchBuyingGuides } from "@/lib/api";
import { cn, formatShortDateEs, formatUsd } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { BlurFade } from "./magicui/blur-fade";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

function hasVerifiedSavings(product: ProductSummaryDTO): boolean {
  return (
    product.storeCount >= 2 &&
    product.savingsCents > 0 &&
    product.savingsPercent <= 99
  );
}

function GuideProductRow({
  product,
  rank,
  onOpenProduct,
}: {
  product: ProductSummaryDTO;
  rank: number;
  onOpenProduct: (slug: string) => void;
}) {
  const outUrl = buildOutboundUrl(
    product.bestStore?.listingId,
    product.bestStore?.url,
    "guide"
  );
  const savings = hasVerifiedSavings(product);

  return (
    <article className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7E5DF] bg-white p-3.5 sm:flex-nowrap">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-extrabold tabular-nums",
          rank === 1
            ? "bg-[#111315] text-white"
            : "border border-[#E7E5DF] bg-[#FAFAF7] text-[#525866]"
        )}
        aria-label={`Puesto #${rank}`}
      >
        #{rank}
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpenProduct(product.slug)}
          className="line-clamp-2 text-left text-[14px] leading-snug font-bold tracking-[-0.015em] text-[#111315] transition-colors hover:text-[#E64825] cursor-pointer"
        >
          {product.canonicalName}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#666D7C]">
          {product.bestStore ? (
            <span
              className="inline-flex items-center gap-1 rounded border bg-white px-1.5 py-0.5 font-semibold"
              style={{
                borderColor: `${product.bestStore.color}33`,
                color: product.bestStore.color,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: product.bestStore.color }}
              />
              {product.bestStore.name}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-0.5 font-medium">
            <Layers className="h-3 w-3 text-[#059669]" />
            {product.storeCount}{" "}
            {product.storeCount === 1 ? "tienda" : "tiendas"}
          </span>
          {savings ? (
            <Badge variant="best" className="font-mono text-[10px] tabular-nums">
              <TrendingDown className="h-3 w-3" />
              Ahorras {formatUsd(product.savingsCents)}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <span className="block text-[10px] font-semibold text-[#666D7C]">
          Mejor precio
        </span>
        <span className="font-price text-lg font-bold text-[#047857]">
          {formatUsd(product.bestPriceCents)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => onOpenProduct(product.slug)}>
          Ver comparador
        </Button>
        {outUrl && product.bestStore ? (
          <a
            href={outUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#111315] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#E64825]"
            aria-label={`Ir a ${product.bestStore.name}`}
          >
            <span className="hidden sm:inline">Ir a tienda</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function GuideSection({
  guide,
  onOpenProduct,
}: {
  guide: BuyingGuideDTO;
  onOpenProduct: (slug: string) => void;
}) {
  return (
    <section
      id={`guia-${guide.slug}`}
      className="scroll-2xl scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-[#FAFAF7] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E7E5DF] pb-4">
        <div>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[#111315] sm:text-xl">
            {guide.title}
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[#525866]">
            {guide.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <Badge variant="default" className="font-mono text-[11px]">
            {guide.itemCount} {guide.itemCount === 1 ? "producto" : "productos"}
          </Badge>
          <span className="text-[11px] text-[#666D7C]">
            Actualizada {formatShortDateEs(guide.updatedAt)}
          </span>
        </div>
      </div>

      {guide.items.length === 0 ? (
        <p className="mt-5 text-sm text-[#525866]">
          Aún no hay productos verificados para esta guía. Volverá a generarse en el
          próximo barrido diario.
        </p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {guide.items.map((product, index) => (
            <GuideProductRow
              key={product.id}
              product={product}
              rank={index + 1}
              onOpenProduct={onOpenProduct}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function GuidesView() {
  const openProduct = useFilterStore((s) => s.openProduct);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["buying-guides"],
    queryFn: fetchBuyingGuides,
    staleTime: 60_000,
  });

  const guides = useMemo(() => data?.guides ?? [], [data]);

  return (
    <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
      <BlurFade duration={0.32} yOffset={6}>
        <div className="border-b border-[#E7E5DF] pb-6">
          <Badge variant="savingsSoft" className="mb-3">
            <BookOpen className="h-3 w-3" />
            Guías automáticas · generadas desde precios reales
          </Badge>
          <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#111315] text-balance sm:text-3xl">
            Guías de compra en Panamá, armadas con precios verificados
          </h1>
          <p className="mt-2 max-w-[75ch] text-sm leading-relaxed text-[#525866]">
            Ranking de los mejores productos por categoría según los precios reales de
            las 8 tiendas monitoreadas. Se recalculan solas en cada barrido diario
            (08:00 UTC): nada de listas patrocinadas.
          </p>
        </div>
      </BlurFade>

      {/* Pills para saltar entre guías */}
      {guides.length > 1 ? (
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {guides.map((guide) => (
            <a
              key={guide.slug}
              href={`#guia-${guide.slug}`}
              className="rounded-full border border-[#E7E5DF] bg-white px-3 py-1.5 text-xs font-semibold text-[#111315] transition-colors hover:border-[#E64825] hover:bg-[#FEF2EE] hover:text-[#B83416]"
            >
              {guide.title}
            </a>
          ))}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, idx) => (
            <Skeleton key={idx} className="h-64 w-full rounded-2xl" />
          ))
        ) : isError ? (
          <div className="flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-14 text-center">
            <AlertCircle className="h-8 w-8 text-[#E64825]" />
            <h2 className="mt-3 text-base font-bold text-[#111315]">
              No pudimos cargar las guías de compra
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#525866]">
              {error instanceof Error
                ? error.message
                : "Ocurrió un error al consultar el servidor."}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </div>
        ) : guides.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#D5D2C9] bg-white px-6 py-14 text-center">
            <BookOpen className="h-8 w-8 text-[#666D7C]" />
            <h2 className="mt-3 text-base font-bold text-[#111315]">
              Las guías se están generando
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#525866]">
              Con cada barrido diario generamos rankings automáticos por categoría.
              Vuelve en unos minutos o explora el catálogo mientras tanto.
            </p>
          </div>
        ) : (
          guides.map((guide) => (
            <GuideSection key={guide.slug} guide={guide} onOpenProduct={openProduct} />
          ))
        )}
      </div>
    </section>
  );
}
