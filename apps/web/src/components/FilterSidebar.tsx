import { PANAMA_STORES } from "@regateo/shared";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

interface FilterSidebarProps {
  facetStores: Array<{ slug: string; name: string; count: number }>;
  facetBrands: Array<{ name: string; count: number }>;
  onAfterChange?: () => void;
}

export function FilterSidebar({
  facetStores,
  facetBrands,
  onAfterChange,
}: FilterSidebarProps) {
  const store = useFilterStore((s) => s.store);
  const brand = useFilterStore((s) => s.brand);
  const minPrice = useFilterStore((s) => s.minPrice);
  const maxPrice = useFilterStore((s) => s.maxPrice);
  const inStockOnly = useFilterStore((s) => s.inStockOnly);
  const multiStoreOnly = useFilterStore((s) => s.multiStoreOnly);
  const category = useFilterStore((s) => s.category);
  const q = useFilterStore((s) => s.q);

  const setStore = useFilterStore((s) => s.setStore);
  const setBrand = useFilterStore((s) => s.setBrand);
  const setPriceRange = useFilterStore((s) => s.setPriceRange);
  const setInStockOnly = useFilterStore((s) => s.setInStockOnly);
  const setMultiStoreOnly = useFilterStore((s) => s.setMultiStoreOnly);
  const resetFilters = useFilterStore((s) => s.resetFilters);

  const [minDraft, setMinDraft] = useState(minPrice ? String(minPrice) : "");
  const [maxDraft, setMaxDraft] = useState(maxPrice ? String(maxPrice) : "");

  useEffect(() => {
    setMinDraft(minPrice !== undefined ? String(minPrice) : "");
    setMaxDraft(maxPrice !== undefined ? String(maxPrice) : "");
  }, [minPrice, maxPrice]);

  const hasActiveFilters = Boolean(
    store ||
      brand ||
      minPrice !== undefined ||
      maxPrice !== undefined ||
      inStockOnly ||
      multiStoreOnly ||
      category ||
      q.trim()
  );

  const storeCountMap = new Map(facetStores.map((s) => [s.slug, s.count]));
  const storeList = PANAMA_STORES.map((cfg) => ({
    slug: cfg.slug,
    name: cfg.name,
    color: cfg.color,
    count: storeCountMap.get(cfg.slug) ?? 0,
  }));

  const applyPrice = (e: React.FormEvent) => {
    e.preventDefault();
    const min = minDraft.trim() ? Number(minDraft) : undefined;
    const max = maxDraft.trim() ? Number(maxDraft) : undefined;
    setPriceRange(
      min !== undefined && Number.isFinite(min) && min >= 0 ? min : undefined,
      max !== undefined && Number.isFinite(max) && max > 0 ? max : undefined
    );
    onAfterChange?.();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-[-0.015em] text-[#111315]">
          Filtros de comparación
        </h2>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => {
              resetFilters();
              onAfterChange?.();
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#E64825] hover:text-[#B83416] cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            Limpiar
          </button>
        ) : null}
      </div>

      <div className="space-y-2 border-b border-[#E7E5DF] pb-5">
        <Switch
          id="filter-multi-store"
          checked={multiStoreOnly}
          onCheckedChange={(checked) => {
            setMultiStoreOnly(checked);
            onAfterChange?.();
          }}
          label="Comparables en 2+ tiendas"
          description="Muestra diferencias directas entre comercios"
        />
        <Switch
          id="filter-in-stock"
          checked={inStockOnly}
          onCheckedChange={(checked) => {
            setInStockOnly(checked);
            onAfterChange?.();
          }}
          label="Solo en stock"
          description="Oculta artículos agotados"
        />
      </div>

      <div className="border-b border-[#E7E5DF] pb-5">
        <h3 className="mb-2.5 text-xs font-bold tracking-[0.02em] text-[#525866] uppercase">
          Tiendas de Panamá
        </h3>
        <div className="space-y-1">
          {storeList.map((s) => {
            const active = store === s.slug;
            return (
              <button
                key={s.slug}
                type="button"
                onClick={() => {
                  setStore(active ? undefined : s.slug);
                  onAfterChange?.();
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors cursor-pointer",
                  active
                    ? "bg-[#FEF2EE] font-semibold text-[#B83416]"
                    : "text-[#111315] hover:bg-[#F4F3EE]"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-[#666D7C]">
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-b border-[#E7E5DF] pb-5">
        <h3 className="mb-2.5 text-xs font-bold tracking-[0.02em] text-[#525866] uppercase">
          Rango de precio (USD)
        </h3>
        <form onSubmit={applyPrice} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="min-price" className="mb-1 block text-[11px] font-medium text-[#666D7C]">
                Mínimo ($)
              </label>
              <Input
                id="min-price"
                type="number"
                min={0}
                step="1"
                placeholder="0"
                value={minDraft}
                onChange={(e) => setMinDraft(e.target.value)}
                className="h-9 font-mono text-xs tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="max-price" className="mb-1 block text-[11px] font-medium text-[#666D7C]">
                Máximo ($)
              </label>
              <Input
                id="max-price"
                type="number"
                min={0}
                step="1"
                placeholder="2500"
                value={maxDraft}
                onChange={(e) => setMaxDraft(e.target.value)}
                className="h-9 font-mono text-xs tabular-nums"
              />
            </div>
          </div>
          <Button type="submit" variant="secondary" size="sm" className="w-full">
            Aplicar precio
          </Button>
        </form>
      </div>

      {facetBrands.length > 0 ? (
        <div>
          <h3 className="mb-2.5 text-xs font-bold tracking-[0.02em] text-[#525866] uppercase">
            Marcas destacadas
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {facetBrands.slice(0, 14).map((b) => {
              const active = brand?.toLowerCase() === b.name.toLowerCase();
              return (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => {
                    setBrand(active ? undefined : b.name);
                    onAfterChange?.();
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    active
                      ? "border-[#111315] bg-[#111315] text-white"
                      : "border-[#E7E5DF] bg-white text-[#525866] hover:border-[#D5D2C9] hover:text-[#111315]"
                  )}
                >
                  <span>{b.name}</span>
                  <span
                    className={cn(
                      "font-mono text-[10px] tabular-nums",
                      active ? "text-white/75" : "text-[#666D7C]"
                    )}
                  >
                    {b.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
