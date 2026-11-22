import { PRODUCT_CATEGORIES, type ProductCategory } from "@regateo/shared";
import { LayoutGrid } from "lucide-react";
import { cn, getCategoryShortLabel } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CategoryIcon } from "./CategoryIcon";

interface CategoryRibbonProps {
  facetCategories: Array<{ key: ProductCategory; count: number }>;
  totalProducts: number;
}

export function CategoryRibbon({ facetCategories, totalProducts }: CategoryRibbonProps) {
  const activeCategory = useFilterStore((s) => s.category);
  const setCategory = useFilterStore((s) => s.setCategory);

  const countMap = new Map<ProductCategory, number>();
  for (const fc of facetCategories) {
    countMap.set(fc.key, fc.count);
  }

  return (
    <div className="border-b border-[#E7E5DF] bg-[#FAFAF7]">
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
        <div
          className="no-scrollbar flex items-center gap-2 overflow-x-auto py-3"
          role="tablist"
          aria-label="Categorías de productos"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!activeCategory}
            onClick={() => setCategory(undefined)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer",
              !activeCategory
                ? "border-[#111315] bg-[#111315] text-white"
                : "border-[#E7E5DF] bg-white text-[#525866] hover:border-[#D5D2C9] hover:text-[#111315]"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Todo</span>
            {totalProducts > 0 ? (
              <span
                className={cn(
                  "ml-0.5 font-mono text-[11px] tabular-nums",
                  !activeCategory ? "text-white/75" : "text-[#666D7C]"
                )}
              >
                {totalProducts}
              </span>
            ) : null}
          </button>

          {PRODUCT_CATEGORIES.map((cat) => {
            const count = countMap.get(cat) ?? 0;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setCategory(isActive ? undefined : cat)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer",
                  isActive
                    ? "border-[#E64825] bg-[#FEF2EE] text-[#B83416]"
                    : "border-[#E7E5DF] bg-white text-[#525866] hover:border-[#D5D2C9] hover:text-[#111315]"
                )}
              >
                <CategoryIcon
                  category={cat}
                  className={cn(
                    "h-3.5 w-3.5",
                    isActive ? "text-[#E64825]" : "text-[#666D7C]"
                  )}
                />
                <span>{getCategoryShortLabel(cat)}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "ml-0.5 font-mono text-[11px] tabular-nums",
                      isActive ? "text-[#B83416]/80" : "text-[#666D7C]"
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
