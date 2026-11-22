import type { ProductCategory } from "@regateo/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Flame, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { fetchDeals } from "@/lib/api";
import { cn, formatUsd, getCategoryShortLabel } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { BlurFade } from "./magicui/blur-fade";
import { ProductCard } from "./ProductCard";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export function DealsView() {
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | "all">(
    "all"
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["deals"],
    queryFn: fetchDeals,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  const availableCategories = useMemo(() => {
    const counts = new Map<ProductCategory, number>();
    for (const item of items) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filteredItems =
    selectedCategory === "all"
      ? items
      : items.filter((item) => item.category === selectedCategory);

  const topSavingsCents = items.reduce(
    (max, item) => (item.savingsCents > max ? item.savingsCents : max),
    0
  );

  return (
    <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
      <BlurFade duration={0.32} yOffset={6}>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E7E5DF] pb-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#111315] text-balance sm:text-3xl">
              Mayores ahorros verificados en Panamá
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#525866]">
              Productos con la mayor diferencia real entre tiendas panameñas o rebajas
              comprobadas sobre su precio anterior.
              {topSavingsCents >= 100 ? (
                <>
                  {" "}
                  Ahorro máximo detectado hoy:{" "}
                  <strong className="font-price text-[#B83416]">
                    {formatUsd(topSavingsCents)}
                  </strong>
                  .
                </>
              ) : null}
            </p>
          </div>

          <Button
            variant="brand"
            size="sm"
            onClick={() =>
              setAiOpen(
                true,
                "Resúmeme las 5 mejores ofertas reales de hoy en Panamá con mayor ahorro en USD."
              )
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            Analizar ofertas con IA
          </Button>
        </div>
      </BlurFade>

      {/* Category filter pills */}
      {availableCategories.length > 1 ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
              selectedCategory === "all"
                ? "border-[#111315] bg-[#111315] text-white"
                : "border-[#E7E5DF] bg-white text-[#525866] hover:text-[#111315]"
            )}
          >
            Todas ({items.length})
          </button>
          {availableCategories.map(([cat, count]) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                selectedCategory === cat
                  ? "border-[#E64825] bg-[#FEF2EE] text-[#B83416]"
                  : "border-[#E7E5DF] bg-white text-[#525866] hover:text-[#111315]"
              )}
            >
              {getCategoryShortLabel(cat)} ({count})
            </button>
          ))}
        </div>
      ) : null}

      {/* Content */}
      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-[#E7E5DF] bg-white p-4 space-y-3"
              >
                <Skeleton className="aspect-[16/10] w-full" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-14 text-center">
            <AlertCircle className="h-8 w-8 text-[#E64825]" />
            <h2 className="mt-3 text-base font-bold text-[#111315]">
              No pudimos cargar las ofertas destacadas
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#525866]">
              {error instanceof Error
                ? error.message
                : "Ocurrió un error al consultar el servidor."}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-14 text-center">
            <Flame className="h-8 w-8 text-[#666D7C]" />
            <h2 className="mt-3 text-base font-bold text-[#111315]">
              Aún no hay ofertas destacadas en esta categoría
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#525866]">
              Explora el catálogo completo o ejecuta un nuevo barrido desde Tiendas y
              Radar.
            </p>
            <Button
              variant="primary"
              className="mt-4"
              onClick={() => setActiveView("catalogo")}
            >
              Ir al catálogo
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                featured={index === 0}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
