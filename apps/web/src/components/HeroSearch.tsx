import { PANAMA_STORES, type StoreStatusDTO } from "@regateo/shared";
import {
  ArrowRight,
  Clock,
  Layers,
  Search,
  Sparkles,
  Store,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, formatRelativeEs } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { BlurFade } from "./magicui/blur-fade";
import { Marquee } from "./magicui/marquee";
import { NumberTicker } from "./magicui/number-ticker";

const QUICK_SEARCHES = [
  "Lavadora",
  "Laptop",
  "Mouse",
  "Smart TV",
  "Aire acondicionado",
  "Audífonos",
];

const ACTIVE_STORE_SLUGS = [
  "multimax",
  "panafoto",
  "rodelag",
  "titan",
  "photura",
  "doitcenter",
  "yoytec",
  "ptytec",
] as const;

interface HeroSearchProps {
  totalProducts: number;
  monitoredStoresCount: number;
  lastScrapedAt: string | null;
  isLoadingStats?: boolean;
  stores?: StoreStatusDTO[];
  comparableCount?: number | null;
}

export function HeroSearch({
  totalProducts,
  monitoredStoresCount,
  lastScrapedAt,
  isLoadingStats,
  stores,
  comparableCount,
}: HeroSearchProps) {
  const q = useFilterStore((s) => s.q);
  const selectedStore = useFilterStore((s) => s.store);
  const setQuery = useFilterStore((s) => s.setQuery);
  const setStore = useFilterStore((s) => s.setStore);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);

  const [draft, setDraft] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft !== q) {
        setQuery(draft);
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [draft, q, setQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === "/" && !isEditable) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const marqueeStores = useMemo(() => {
    const apiBySlug = new Map((stores ?? []).map((item) => [item.slug, item]));
    return ACTIVE_STORE_SLUGS.map((slug) => {
      const apiStore = apiBySlug.get(slug);
      const configStore = PANAMA_STORES.find((item) => item.slug === slug);
      return {
        slug,
        name: apiStore?.name ?? configStore?.name ?? slug,
        color: apiStore?.color ?? configStore?.color ?? "#525866",
        listingCount: apiStore?.listingCount ?? null,
      };
    });
  }, [stores]);

  const handleQuickSearch = (term: string) => {
    setDraft(term);
    setQuery(term);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(draft);
  };

  const displayedStoresCount =
    monitoredStoresCount > 0 ? monitoredStoresCount : ACTIVE_STORE_SLUGS.length;

  return (
    <section className="border-b border-[#E7E5DF] bg-white">
      <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <BlurFade className="max-w-3xl" duration={0.32} yOffset={6}>
          <h1 className="text-[28px] leading-[1.12] font-extrabold tracking-[-0.03em] text-[#111315] text-balance sm:text-[38px]">
            Encuentra el mejor precio en tecnología en Panamá sin abrir 10 pestañas.
          </h1>
          <p className="mt-2.5 max-w-[66ch] text-[15px] leading-relaxed text-[#525866]">
            Precios reales verificados en Multimax, Panafoto, Rodelag, Almacenes Titán,
            Photura, Do it Center, Yoytec y PTYTEC con enlaces directos a cada tienda.
          </p>
        </BlurFade>

        <BlurFade delay={0.06} duration={0.32} yOffset={6}>
          <form onSubmit={handleSubmit} className="mt-6 max-w-3xl">
            <div className="group relative flex items-center rounded-xl border border-[#D5D2C9] bg-[#FAFAF7] p-1.5 transition-colors focus-within:border-[#E64825] focus-within:bg-white focus-within:ring-3 focus-within:ring-[#E64825]/12">
              <Search
                className="ml-3 h-5 w-5 shrink-0 text-[#666D7C] group-focus-within:text-[#E64825]"
                strokeWidth={2}
              />
              <input
                ref={inputRef}
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Busca por producto, marca o modelo (ej. Samsung QLED, HP 15, Logitech MX)..."
                aria-label="Buscar productos de tecnología en Panamá"
                className="h-10 w-full bg-transparent px-3 text-[15px] text-[#111315] placeholder:text-[#666D7C] focus:outline-none"
              />
              {draft ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraft("");
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Limpiar búsqueda"
                  className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#666D7C] hover:bg-[#EFECE5] hover:text-[#111315] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd className="mr-2 hidden rounded-md border border-[#E7E5DF] bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-[#666D7C] sm:inline-block">
                  /
                </kbd>
              )}
              <button
                type="submit"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[#111315] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#24282F] cursor-pointer"
              >
                <span>Buscar</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>

          <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-[#666D7C]">
              Búsquedas rápidas:
            </span>
            {QUICK_SEARCHES.map((term) => {
              const active = q.toLowerCase() === term.toLowerCase();
              return (
                <button
                  key={term}
                  type="button"
                  onClick={() => handleQuickSearch(term)}
                  className={
                    active
                      ? "rounded-full border border-[#E64825] bg-[#FEF2EE] px-3 py-1 text-xs font-semibold text-[#B83416] cursor-pointer"
                      : "rounded-full border border-[#E7E5DF] bg-[#FAFAF7] px-3 py-1 text-xs font-medium text-[#525866] transition-colors hover:border-[#D5D2C9] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                  }
                >
                  {term}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setAiOpen(
                  true,
                  draft.trim()
                    ? `Ayúdame a comparar opciones y encontrar el mejor precio en Panamá para: ${draft.trim()}`
                    : "¿Cuáles son las mejores ofertas reales en Panamá hoy?"
                )
              }
              className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-[#FBCFC3] bg-[#FEF2EE] px-3 py-1 text-xs font-semibold text-[#B83416] transition-colors hover:bg-[#FDE5DC] cursor-pointer"
            >
              <Sparkles className="h-3 w-3" />
              <span>Preguntar a Regateo AI</span>
            </button>
          </div>
        </BlurFade>

        {/* Active Panama stores marquee */}
        <div className="mt-6 border-t border-[#E7E5DF] pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#525866]">
              <button
                type="button"
                onClick={() => setActiveView("tiendas")}
                className="inline-flex items-center gap-1.5 font-medium text-[#111315] hover:text-[#E64825] cursor-pointer"
              >
                <Store className="h-3.5 w-3.5 text-[#059669]" strokeWidth={2} />
                <span className="font-semibold">
                  <NumberTicker value={displayedStoresCount} /> tiendas
                </span>
                <span className="font-normal text-[#525866]">
                  monitoreadas en Panamá
                </span>
              </button>

              <span className="hidden h-3.5 w-px bg-[#E7E5DF] sm:inline-block" />

              <div className="inline-flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-[#E64825]" strokeWidth={2} />
                <span className="min-w-[3ch] font-semibold tabular-nums text-[#111315]">
                  {isLoadingStats ? (
                    "..."
                  ) : (
                    <NumberTicker value={totalProducts} />
                  )}
                </span>
                <span>productos monitoreados</span>
              </div>

              {typeof comparableCount === "number" && comparableCount > 0 ? (
                <>
                  <span className="hidden h-3.5 w-px bg-[#E7E5DF] sm:inline-block" />

                  <div className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-[#059669]" strokeWidth={2} />
                    <span className="font-semibold tabular-nums text-[#111315]">
                      {isLoadingStats
                        ? "..."
                        : comparableCount.toLocaleString("en-US")}
                    </span>
                    <span>comparados en 2+ tiendas</span>
                  </div>
                </>
              ) : null}

              <span className="hidden h-3.5 w-px bg-[#E7E5DF] sm:inline-block" />

              <div className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#666D7C]" strokeWidth={2} />
                <span>
                  Última verificación:{" "}
                  <strong className="font-semibold text-[#111315]">
                    {lastScrapedAt
                      ? formatRelativeEs(lastScrapedAt)
                      : "Barrido diario automático (08:00 UTC)"}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3.5">
            <Marquee pauseOnHover durationSeconds={42} gap="0.625rem" repeat={3}>
              {marqueeStores.map((store) => {
                const isSelected = selectedStore === store.slug;
                return (
                  <button
                    key={store.slug}
                    type="button"
                    onClick={() =>
                      setStore(isSelected ? undefined : store.slug)
                    }
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer",
                      isSelected
                        ? "border-[#111315] bg-[#111315] text-white"
                        : "border-[#E7E5DF] bg-[#FAFAF7] text-[#111315] hover:border-[#D5D2C9] hover:bg-[#F4F3EE]"
                    )}
                    title={`Filtrar productos de ${store.name}`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: store.color }}
                    />
                    <span className="font-semibold">{store.name}</span>
                    {store.listingCount !== null ? (
                      <span
                        className={cn(
                          "font-mono text-[11px] tabular-nums",
                          isSelected ? "text-white/75" : "text-[#666D7C]"
                        )}
                      >
                        {store.listingCount.toLocaleString("en-US")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </Marquee>
          </div>
        </div>
      </div>
    </section>
  );
}
