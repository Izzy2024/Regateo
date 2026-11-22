import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { CategoryRibbon } from "@/components/CategoryRibbon";
import { CompareTray } from "@/components/CompareTray";
import { FilterSidebar } from "@/components/FilterSidebar";
import { Header } from "@/components/Header";
import { HeroSearch } from "@/components/HeroSearch";
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchProducts, fetchStores } from "@/lib/api";
import { cn, getCategoryLabel } from "@/lib/utils";
import {
  type AppView,
  type SortOption,
  useFilterStore,
} from "@/store/useFilterStore";

const DealsView = lazy(() =>
  import("@/components/DealsView").then((m) => ({ default: m.DealsView }))
);
const StoresDashboard = lazy(() =>
  import("@/components/StoresDashboard").then((m) => ({
    default: m.StoresDashboard,
  }))
);
const GuidesView = lazy(() =>
  import("@/components/GuidesView").then((m) => ({ default: m.GuidesView }))
);
const AccountSpaceView = lazy(() =>
  import("@/components/AccountSpaceView").then((m) => ({
    default: m.AccountSpaceView,
  }))
);
const PrivacyPolicyView = lazy(() =>
  import("@/components/PrivacyPolicyView").then((m) => ({
    default: m.PrivacyPolicyView,
  }))
);
const ProductDetailModal = lazy(() =>
  import("@/components/ProductDetailModal").then((m) => ({
    default: m.ProductDetailModal,
  }))
);
const AiAssistantDrawer = lazy(() =>
  import("@/components/AiAssistantDrawer").then((m) => ({
    default: m.AiAssistantDrawer,
  }))
);
const AuthModal = lazy(() =>
  import("@/components/AuthModal").then((m) => ({ default: m.AuthModal }))
);

const FOOTER_LINKS: Array<{ view: AppView; label: string }> = [
  { view: "catalogo", label: "Explorar catálogo" },
  { view: "ofertas", label: "Mejores ofertas" },
  { view: "guias", label: "Guías de compra" },
  { view: "tiendas", label: "Tiendas y radar" },
  { view: "mi-espacio", label: "Mi Espacio" },
  { view: "privacidad", label: "Política de Privacidad" },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "most-stores", label: "Comparables en 2+ tiendas" },
  { value: "relevance", label: "Relevancia" },
  { value: "best-savings", label: "Mayor ahorro" },
  { value: "price-asc", label: "Menor precio" },
  { value: "price-desc", label: "Mayor precio" },
  { value: "recent", label: "Más recientes" },
];

export function App() {
  const activeView = useFilterStore((s) => s.activeView);
  const q = useFilterStore((s) => s.q);
  const category = useFilterStore((s) => s.category);
  const store = useFilterStore((s) => s.store);
  const brand = useFilterStore((s) => s.brand);
  const minPrice = useFilterStore((s) => s.minPrice);
  const maxPrice = useFilterStore((s) => s.maxPrice);
  const inStockOnly = useFilterStore((s) => s.inStockOnly);
  const multiStoreOnly = useFilterStore((s) => s.multiStoreOnly);
  const sort = useFilterStore((s) => s.sort);
  const page = useFilterStore((s) => s.page);
  const limit = useFilterStore((s) => s.limit);
  const mobileFiltersOpen = useFilterStore((s) => s.mobileFiltersOpen);
  const selectedProductSlug = useFilterStore((s) => s.selectedProductSlug);
  const aiOpen = useFilterStore((s) => s.aiOpen);
  const authOpen = useFilterStore((s) => s.authOpen);

  const setSort = useFilterStore((s) => s.setSort);
  const setPage = useFilterStore((s) => s.setPage);
  const setCategory = useFilterStore((s) => s.setCategory);
  const setStore = useFilterStore((s) => s.setStore);
  const setBrand = useFilterStore((s) => s.setBrand);
  const setPriceRange = useFilterStore((s) => s.setPriceRange);
  const setInStockOnly = useFilterStore((s) => s.setInStockOnly);
  const setMultiStoreOnly = useFilterStore((s) => s.setMultiStoreOnly);
  const setQuery = useFilterStore((s) => s.setQuery);
  const resetFilters = useFilterStore((s) => s.resetFilters);
  const setMobileFiltersOpen = useFilterStore((s) => s.setMobileFiltersOpen);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const syncFromLocation = useFilterStore((s) => s.syncFromLocation);
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);

  const navigateFromFooter = (view: AppView) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Keep state synced with browser back/forward URL params
  useEffect(() => {
    const onPopState = () => syncFromLocation();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [syncFromLocation]);

  // Abre automáticamente el restablecimiento de contraseña si la URL trae ?resetToken/?token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("resetToken") || params.get("token")) {
      setAuthOpen(true, { mode: "signin" });
    }
  }, [setAuthOpen]);

  const queryParams = {
    q: q.trim() || undefined,
    category,
    store,
    brand,
    minPrice,
    maxPrice,
    inStockOnly: inStockOnly || undefined,
    multiStoreOnly: multiStoreOnly || undefined,
    sort,
    page,
    limit,
  };

  const productsQuery = useQuery({
    queryKey: ["products", queryParams],
    queryFn: () => fetchProducts(queryParams),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });

  const storesMetaQuery = useQuery({
    queryKey: ["stores"],
    queryFn: fetchStores,
    staleTime: 60_000,
  });

  const data = productsQuery.data;
  const items = data?.items ?? [];
  const pagination = data?.pagination ?? {
    page: 1,
    limit: 24,
    total: 0,
    totalPages: 1,
  };
  const facets = data?.facets ?? {
    categories: [],
    brands: [],
    stores: [],
  };

  const activeFilterChips: Array<{ label: string; onRemove: () => void }> = [];
  if (q.trim()) {
    activeFilterChips.push({
      label: `Búsqueda: "${q.trim()}"`,
      onRemove: () => setQuery(""),
    });
  }
  if (category) {
    activeFilterChips.push({
      label: getCategoryLabel(category),
      onRemove: () => setCategory(undefined),
    });
  }
  if (store) {
    const storeName =
      facets.stores.find((s) => s.slug === store)?.name ?? store;
    activeFilterChips.push({
      label: `Tienda: ${storeName}`,
      onRemove: () => setStore(undefined),
    });
  }
  if (brand) {
    activeFilterChips.push({
      label: `Marca: ${brand}`,
      onRemove: () => setBrand(undefined),
    });
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    activeFilterChips.push({
      label: `Precio: ${minPrice ? `$${minPrice}` : "$0"} – ${
        maxPrice ? `$${maxPrice}` : "∞"
      }`,
      onRemove: () => setPriceRange(undefined, undefined),
    });
  }
  if (multiStoreOnly) {
    activeFilterChips.push({
      label: "2+ tiendas",
      onRemove: () => setMultiStoreOnly(false),
    });
  }
  if (inStockOnly) {
    activeFilterChips.push({
      label: "Solo en stock",
      onRemove: () => setInStockOnly(false),
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF7] text-[#111315]">
      <Header />

      <main className="flex-1 pb-24">
        {activeView === "catalogo" ? (
          <>
            <HeroSearch
              totalProducts={pagination.total}
              monitoredStoresCount={storesMetaQuery.data?.stores.length ?? 8}
              lastScrapedAt={data?.meta.lastScrapedAt ?? null}
              isLoadingStats={productsQuery.isLoading && !data}
              stores={storesMetaQuery.data?.stores}
              comparableCount={data?.meta.comparableCount ?? null}
            />

            <CategoryRibbon
              facetCategories={facets.categories}
              totalProducts={pagination.total}
            />

            <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8">
              <div className="grid items-start gap-7 lg:grid-cols-[260px_1fr]">
                {/* Desktop Filter Sidebar */}
                <aside className="sticky top-22 hidden rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation lg:block">
                  <FilterSidebar
                    facetStores={facets.stores}
                    facetBrands={facets.brands}
                  />
                </aside>

                {/* Results Column */}
                <div className="min-w-0">
                  {/* Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                    <div className="flex items-center gap-2.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMobileFiltersOpen(true)}
                        className="lg:hidden"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>Filtros</span>
                        {activeFilterChips.length > 0 ? (
                          <span className="ml-0.5 rounded-full bg-[#E64825] px-1.5 py-0.5 font-mono text-[10px] text-white">
                            {activeFilterChips.length}
                          </span>
                        ) : null}
                      </Button>

                      <p className="text-sm text-[#525866]">
                        {productsQuery.isLoading && !data ? (
                          "Consultando precios..."
                        ) : (
                          <>
                            <strong className="font-mono font-bold tabular-nums text-[#111315]">
                              {pagination.total.toLocaleString("en-US")}
                            </strong>{" "}
                            {pagination.total === 1 ? "producto" : "productos"}
                            {productsQuery.isFetching && data ? (
                              <span className="ml-2 text-xs text-[#666D7C]">
                                Actualizando...
                              </span>
                            ) : null}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="sort-select"
                        className="text-xs font-medium text-[#666D7C]"
                      >
                        Ordenar:
                      </label>
                      <select
                        id="sort-select"
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortOption)}
                        className="h-8 rounded-lg border border-[#E7E5DF] bg-white px-2.5 text-xs font-semibold text-[#111315] hover:border-[#D5D2C9] focus:border-[#E64825] focus:outline-none cursor-pointer"
                      >
                        {SORT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Active filter chips */}
                  {activeFilterChips.length > 0 ? (
                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      {activeFilterChips.map((chip) => (
                        <span
                          key={chip.label}
                          className="inline-flex items-center gap-1 rounded-full border border-[#E7E5DF] bg-white py-1 pl-2.5 pr-1.5 text-xs font-medium text-[#111315]"
                        >
                          <span>{chip.label}</span>
                          <button
                            type="button"
                            onClick={chip.onRemove}
                            aria-label={`Quitar filtro ${chip.label}`}
                            className="rounded-full p-0.5 text-[#666D7C] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="px-2 py-1 text-xs font-semibold text-[#E64825] hover:text-[#B83416] cursor-pointer"
                      >
                        Limpiar todo
                      </button>
                    </div>
                  ) : null}

                  {/* Grid states */}
                  {productsQuery.isLoading && !data ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {Array.from({ length: 9 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-[#E7E5DF] bg-white p-4 space-y-3"
                        >
                          <Skeleton className="aspect-[16/10] w-full" />
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-5 w-4/5" />
                          <Skeleton className="h-16 w-full" />
                          <Skeleton className="h-9 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : productsQuery.isError ? (
                    <div className="flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-14 text-center">
                      <AlertCircle className="h-8 w-8 text-[#E64825]" />
                      <h2 className="mt-3 text-base font-bold text-[#111315]">
                        No pudimos conectar con el catálogo de precios
                      </h2>
                      <p className="mt-1 max-w-md text-sm text-[#525866]">
                        {productsQuery.error instanceof Error
                          ? productsQuery.error.message
                          : "Verifica que la API de Regateo esté corriendo."}
                      </p>
                      <Button
                        variant="primary"
                        className="mt-4"
                        onClick={() => productsQuery.refetch()}
                      >
                        Reintentar conexión
                      </Button>
                    </div>
                  ) : items.length === 0 ? (
                    <div className="flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-14 text-center">
                      <SearchX className="h-8 w-8 text-[#666D7C]" />
                      <h2 className="mt-3 text-base font-bold text-[#111315]">
                        Sin resultados para esos filtros
                      </h2>
                      <p className="mt-1 max-w-md text-sm text-[#525866]">
                        Prueba ampliar el rango de precio, quitar el filtro de tiendas o
                        preguntarle directamente a Regateo AI.
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        <Button variant="outline" onClick={resetFilters}>
                          Restablecer filtros
                        </Button>
                        <Button
                          variant="brand"
                          onClick={() =>
                            setAiOpen(
                              true,
                              q.trim()
                                ? `Busqué "${q.trim()}" y no encontré coincidencias exactas. ¿Qué alternativas similares hay en Panamá?`
                                : "Recomiéndame los mejores productos en descuento hoy."
                            )
                          }
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Preguntar a Regateo AI
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {items.map((product) => (
                          <ProductCard key={product.id} product={product} />
                        ))}
                      </div>

                      {/* Pagination */}
                      {pagination.totalPages > 1 ? (
                        <div className="mt-8 flex items-center justify-between border-t border-[#E7E5DF] pt-5">
                          <span className="text-xs text-[#525866]">
                            Página{" "}
                            <strong className="font-mono text-[#111315]">
                              {pagination.page}
                            </strong>{" "}
                            de{" "}
                            <strong className="font-mono text-[#111315]">
                              {pagination.totalPages}
                            </strong>
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pagination.page <= 1}
                              onClick={() => {
                                setPage(pagination.page - 1);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Anterior
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pagination.page >= pagination.totalPages}
                              onClick={() => {
                                setPage(pagination.page + 1);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Siguiente
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : activeView === "ofertas" ? (
          <Suspense
            fallback={
              <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-72" />
                <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-72 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            }
          >
            <DealsView />
          </Suspense>
        ) : activeView === "mi-espacio" ? (
          <Suspense
            fallback={
              <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-64" />
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-28 w-full rounded-xl" />
                  ))}
                </div>
                <Skeleton className="mt-8 h-64 w-full rounded-xl" />
              </div>
            }
          >
            <AccountSpaceView />
          </Suspense>
        ) : activeView === "privacidad" ? (
          <Suspense
            fallback={
              <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-80" />
                <Skeleton className="mt-4 h-36 w-full rounded-2xl" />
                <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
                  <Skeleton className="hidden h-72 rounded-xl lg:block" />
                  <div className="space-y-4">
                    <Skeleton className="h-44 w-full rounded-2xl" />
                    <Skeleton className="h-44 w-full rounded-2xl" />
                  </div>
                </div>
              </div>
            }
          >
            <PrivacyPolicyView />
          </Suspense>
        ) : activeView === "guias" ? (
          <Suspense
            fallback={
              <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-80" />
                <div className="mt-6 space-y-4">
                  <Skeleton className="h-20 w-full rounded-2xl" />
                  <Skeleton className="h-64 w-full rounded-2xl" />
                </div>
              </div>
            }
          >
            <GuidesView />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
                <Skeleton className="h-10 w-80" />
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-44 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            }
          >
            <StoresDashboard />
          </Suspense>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E7E5DF] bg-white">
        <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E7E5DF] bg-white p-1 shadow-[0_1px_2px_rgba(17,19,21,0.03)]">
                <img
                  src="/logo-mark.webp"
                  alt="Logo de Regateo"
                  width={192}
                  height={192}
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              </span>
              <div>
                <div className="text-[15px] font-extrabold tracking-[-0.03em] text-[#111315]">
                  Regateo
                </div>
                <p className="mt-0.5 text-xs text-[#525866]">
                  Comparador independiente de electrónica en Panamá ·{" "}
                  {storesMetaQuery.data?.stores.length ?? 8} tiendas verificadas
                </p>
              </div>
            </div>

            <nav
              aria-label="Enlaces del pie de página"
              className="flex flex-wrap items-center gap-x-5 gap-y-2"
            >
              {FOOTER_LINKS.map((link) => {
                const isActive = activeView === link.view;
                return (
                  <button
                    key={link.view}
                    type="button"
                    onClick={() => navigateFromFooter(link.view)}
                    className={cn(
                      "text-xs font-semibold transition-colors cursor-pointer",
                      isActive
                        ? "text-[#E64825]"
                        : "text-[#525866] hover:text-[#111315]"
                    )}
                  >
                    {link.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-6 flex flex-col gap-2 border-t border-[#EFECE5] pt-5 text-[11px] leading-relaxed text-[#666D7C] sm:flex-row sm:items-center sm:justify-between">
            <p>
              Regateo no vende productos ni procesa pagos. Todos los enlaces
              dirigen a las tiendas oficiales para verificar el precio final.
            </p>
            <p className="shrink-0 font-mono text-[11px] text-[#666D7C]">
              © {new Date().getFullYear()} Regateo · Panamá (USD)
            </p>
          </div>
        </div>
      </footer>

      {/* Mobile Filters Sheet */}
      <Sheet
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        side="left"
        title="Filtros"
        subtitle="Ajusta tiendas, marca y precio en USD"
      >
        <div className="flex-1 overflow-y-auto p-5">
          <FilterSidebar
            facetStores={facets.stores}
            facetBrands={facets.brands}
            onAfterChange={() => setMobileFiltersOpen(false)}
          />
        </div>
      </Sheet>

      {/* Global Overlays */}
      <Suspense fallback={null}>
        {selectedProductSlug ? <ProductDetailModal /> : null}
        {aiOpen ? <AiAssistantDrawer /> : null}
        {authOpen ? <AuthModal /> : null}
      </Suspense>
      <CompareTray />
    </div>
  );
}

export default App;
