import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
  type ProductSearchQuery,
  type ProductSummaryDTO,
} from "@regateo/shared";
import { create } from "zustand";

export type AppView =
  | "catalogo"
  | "ofertas"
  | "guias"
  | "tiendas"
  | "mi-espacio"
  | "privacidad";
export type SortOption = ProductSearchQuery["sort"];
export type AuthModalMode = "signin" | "signup";

const FAVORITES_KEY = "regateoapp:favorites:v1";
const FAVORITE_IDS_KEY = "regateoapp:favorite-ids:v1";
const FAVORITE_ITEMS_KEY = "regateoapp:favorite-items:v1";
const COMPARE_KEY = "regateoapp:compare:v1";

function loadStoredArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveStoredArray<T>(key: string, value: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

function readInitialProductSlug(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("producto");
}

function readInitialView(): AppView {
  if (typeof window === "undefined") return "catalogo";
  const vista = new URLSearchParams(window.location.search).get("vista");
  if (
    vista === "ofertas" ||
    vista === "tiendas" ||
    vista === "catalogo" ||
    vista === "guias" ||
    vista === "mi-espacio" ||
    vista === "privacidad"
  ) {
    return vista;
  }
  return "catalogo";
}

const DEFAULT_SORT: SortOption = "most-stores";
const VALID_SORTS: SortOption[] = [
    "relevance",
    "most-stores",
    "best-savings",
    "price-asc",
    "price-desc",
    "recent",
];

// Parámetros que este store gestiona en la URL; los demás (utm_*, etc.) se preservan.
const MANAGED_URL_KEYS: readonly string[] = [
  "q",
  "category",
  "store",
  "brand",
  "minPrice",
  "maxPrice",
  "inStockOnly",
  "multiStoreOnly",
  "sort",
  "vista",
  "producto",
];

interface UrlSyncState {
  q: string;
  category: ProductCategory | undefined;
  store: string | undefined;
  brand: string | undefined;
  minPrice: number | undefined;
  maxPrice: number | undefined;
  inStockOnly: boolean;
  multiStoreOnly: boolean;
  sort: SortOption;
  activeView: AppView;
  selectedProductSlug: string | null;
}

type UrlFilterState = Omit<UrlSyncState, "activeView" | "selectedProductSlug">;

const EMPTY_URL_FILTERS: UrlFilterState = {
  q: "",
  category: undefined,
  store: undefined,
  brand: undefined,
  minPrice: undefined,
  maxPrice: undefined,
  inStockOnly: false,
  multiStoreOnly: false,
  sort: DEFAULT_SORT,
};

function readInitialFilters(): UrlFilterState {
  if (typeof window === "undefined") return EMPTY_URL_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const sortParam = params.get("sort");
  const categoryParam = params.get("category");
  const minPrice = Number.parseFloat(params.get("minPrice") ?? "");
  const maxPrice = Number.parseFloat(params.get("maxPrice") ?? "");
  return {
    q: params.get("q") ?? "",
    category:
      categoryParam &&
      (PRODUCT_CATEGORIES as readonly string[]).includes(categoryParam)
        ? (categoryParam as ProductCategory)
        : undefined,
    store: params.get("store") ?? undefined,
    brand: params.get("brand") ?? undefined,
    minPrice: Number.isFinite(minPrice) && minPrice > 0 ? minPrice : undefined,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
    inStockOnly: params.get("inStockOnly") === "true",
    multiStoreOnly: params.get("multiStoreOnly") === "true",
    sort:
      sortParam && (VALID_SORTS as readonly string[]).includes(sortParam)
        ? (sortParam as SortOption)
        : DEFAULT_SORT,
  };
}

/** URL compartible con el estado completo de filtros (WhatsApp abre igual). */
function buildShareUrl(state: UrlSyncState): string {
  const current = new URL(window.location.href);
  const params = new URLSearchParams();
  for (const [key, value] of current.searchParams.entries()) {
    if (!MANAGED_URL_KEYS.includes(key)) {
      params.set(key, value);
    }
  }
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.category) params.set("category", state.category);
  if (state.store) params.set("store", state.store);
  if (state.brand) params.set("brand", state.brand);
  if (state.minPrice !== undefined) params.set("minPrice", String(state.minPrice));
  if (state.maxPrice !== undefined) params.set("maxPrice", String(state.maxPrice));
  if (state.inStockOnly) params.set("inStockOnly", "true");
  if (state.multiStoreOnly) params.set("multiStoreOnly", "true");
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.activeView !== "catalogo") params.set("vista", state.activeView);
  if (state.selectedProductSlug) params.set("producto", state.selectedProductSlug);
  const qs = params.toString();
  return `${current.pathname}${qs ? `?${qs}` : ""}${current.hash}`;
}

export interface GuestFavoriteSummary {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  category: ProductCategory;
  imageUrl: string | null;
  bestPriceCents: number;
  bestStoreName: string | null;
  bestStoreUrl: string | null;
  savedAt: string;
}

interface FilterState {
  activeView: AppView;
  selectedProductSlug: string | null;
  aiOpen: boolean;
  aiInitialPrompt: string | null;
  authOpen: boolean;
  authMode: AuthModalMode;
  authHint: string | null;
  compareModalOpen: boolean;
  mobileFiltersOpen: boolean;

  q: string;
  category: ProductCategory | undefined;
  store: string | undefined;
  brand: string | undefined;
  minPrice: number | undefined;
  maxPrice: number | undefined;
  inStockOnly: boolean;
  multiStoreOnly: boolean;
  sort: SortOption;
  page: number;
  limit: number;

  /** Product UUIDs saved as guest before logging in (synced to /api/me/favorites/sync) */
  favorites: string[];
  /** Lightweight local snapshot of guest favorites for preview in Mi Espacio */
  guestFavoriteItems: GuestFavoriteSummary[];
  /** Legacy slug list kept in sync for backward compatibility */
  favoriteSlugs: string[];
  compareItems: ProductSummaryDTO[];

  setActiveView: (view: AppView) => void;
  openProduct: (slug: string) => void;
  closeProduct: () => void;
  syncFromLocation: () => void;

  setAiOpen: (open: boolean, initialPrompt?: string | null) => void;
  setAuthOpen: (
    open: boolean,
    options?: { mode?: AuthModalMode; hint?: string | null }
  ) => void;
  setCompareModalOpen: (open: boolean) => void;
  setMobileFiltersOpen: (open: boolean) => void;

  setQuery: (q: string) => void;
  setCategory: (category: ProductCategory | undefined) => void;
  setStore: (store: string | undefined) => void;
  setBrand: (brand: string | undefined) => void;
  setPriceRange: (minPrice?: number, maxPrice?: number) => void;
  setInStockOnly: (inStockOnly: boolean) => void;
  setMultiStoreOnly: (multiStoreOnly: boolean) => void;
  setSort: (sort: SortOption) => void;
  setPage: (page: number) => void;
  resetFilters: () => void;

  toggleFavorite: (slug: string) => void;
  toggleGuestFavorite: (productId: string, product?: ProductSummaryDTO) => boolean;
  clearGuestFavorites: () => void;
  toggleCompareItem: (item: ProductSummaryDTO) => void;
  removeCompareItem: (id: string) => void;
  clearCompare: () => void;
}

export const useFilterStore = create<FilterState>((set, get) => {
  const writeUrl = (mode: "replace" | "push") => {
    if (typeof window === "undefined") return;
    const url = buildShareUrl(get());
    if (mode === "push") {
      // pushState: el botón Atrás cierra el detalle en lugar de salir del sitio
      window.history.pushState({}, "", url);
    } else {
      window.history.replaceState({}, "", url);
    }
  };

  return {
  activeView: readInitialView(),
  selectedProductSlug: readInitialProductSlug(),
  aiOpen: false,
  aiInitialPrompt: null,
  authOpen: false,
  authMode: "signin",
  authHint: null,
  compareModalOpen: false,
  mobileFiltersOpen: false,

  ...readInitialFilters(),
  page: 1,
  limit: 24,

  favorites: loadStoredArray<string>(FAVORITE_IDS_KEY),
  guestFavoriteItems: loadStoredArray<GuestFavoriteSummary>(FAVORITE_ITEMS_KEY),
  favoriteSlugs: loadStoredArray<string>(FAVORITES_KEY),
  compareItems: loadStoredArray<ProductSummaryDTO>(COMPARE_KEY).slice(0, 3),

  setActiveView: (view) => {
    set({ activeView: view });
    writeUrl("replace");
  },

  openProduct: (slug) => {
    set({ selectedProductSlug: slug });
    writeUrl("push");
  },

  closeProduct: () => {
    set({ selectedProductSlug: null });
    writeUrl("replace");
  },

  syncFromLocation: () => {
    set({
      selectedProductSlug: readInitialProductSlug(),
      activeView: readInitialView(),
      ...readInitialFilters(),
      page: 1,
    });
  },

  setAiOpen: (open, initialPrompt = null) =>
    set({
      aiOpen: open,
      aiInitialPrompt: open ? initialPrompt : null,
    }),

  setAuthOpen: (open, options) =>
    set((state) => ({
      authOpen: open,
      authMode: open ? (options?.mode ?? state.authMode) : "signin",
      authHint: open ? (options?.hint ?? null) : null,
    })),

  setCompareModalOpen: (open) => set({ compareModalOpen: open }),
  setMobileFiltersOpen: (open) => set({ mobileFiltersOpen: open }),

  setQuery: (q) => {
    const trimmed = q.trim();
    const currentSort = get().sort;
    // Con búsqueda activa el orden honesto es Relevancia; al limpiarla volvemos al comparado multi-tienda
    const sort: SortOption = trimmed
      ? "relevance"
      : currentSort === "relevance"
        ? DEFAULT_SORT
        : currentSort;
    set({ q, sort, page: 1 });
    writeUrl("replace");
  },
  setCategory: (category) => {
    set({ category, page: 1 });
    writeUrl("replace");
  },
  setStore: (store) => {
    set({ store, page: 1 });
    writeUrl("replace");
  },
  setBrand: (brand) => {
    set({ brand, page: 1 });
    writeUrl("replace");
  },
  setPriceRange: (minPrice, maxPrice) => {
    set({ minPrice, maxPrice, page: 1 });
    writeUrl("replace");
  },
  setInStockOnly: (inStockOnly) => {
    set({ inStockOnly, page: 1 });
    writeUrl("replace");
  },
  setMultiStoreOnly: (multiStoreOnly) => {
    set({ multiStoreOnly, page: 1 });
    writeUrl("replace");
  },
  setSort: (sort) => {
    set({ sort, page: 1 });
    writeUrl("replace");
  },
  setPage: (page) => set({ page }),

  resetFilters: () => {
    set({ ...EMPTY_URL_FILTERS, page: 1 });
    writeUrl("replace");
  },

  toggleFavorite: (slug) => {
    const current = get().favoriteSlugs;
    const exists = current.includes(slug);
    const next = exists ? current.filter((s) => s !== slug) : [slug, ...current];
    saveStoredArray(FAVORITES_KEY, next);
    set({ favoriteSlugs: next });
  },

  toggleGuestFavorite: (productId, product) => {
    const currentIds = get().favorites;
    const currentItems = get().guestFavoriteItems;
    const currentSlugs = get().favoriteSlugs;
    const exists = currentIds.includes(productId);

    if (exists) {
      const nextIds = currentIds.filter((id) => id !== productId);
      const removedItem = currentItems.find((item) => item.id === productId);
      const nextItems = currentItems.filter((item) => item.id !== productId);
      const slugToRemove = product?.slug ?? removedItem?.slug;
      const nextSlugs = slugToRemove
        ? currentSlugs.filter((s) => s !== slugToRemove)
        : currentSlugs;

      saveStoredArray(FAVORITE_IDS_KEY, nextIds);
      saveStoredArray(FAVORITE_ITEMS_KEY, nextItems);
      saveStoredArray(FAVORITES_KEY, nextSlugs);
      set({
        favorites: nextIds,
        guestFavoriteItems: nextItems,
        favoriteSlugs: nextSlugs,
      });
      return false;
    }

    const nextIds = [productId, ...currentIds].slice(0, 100);
    let nextItems = currentItems;
    let nextSlugs = currentSlugs;

    if (product) {
      const summary: GuestFavoriteSummary = {
        id: product.id,
        slug: product.slug,
        canonicalName: product.canonicalName,
        brand: product.brand,
        category: product.category,
        imageUrl: product.imageUrl,
        bestPriceCents: product.bestPriceCents,
        bestStoreName: product.bestStore?.name ?? null,
        bestStoreUrl: product.bestStore?.url ?? null,
        savedAt: new Date().toISOString(),
      };
      nextItems = [
        summary,
        ...currentItems.filter((item) => item.id !== product.id),
      ].slice(0, 100);
      if (!currentSlugs.includes(product.slug)) {
        nextSlugs = [product.slug, ...currentSlugs].slice(0, 100);
      }
    }

    saveStoredArray(FAVORITE_IDS_KEY, nextIds);
    saveStoredArray(FAVORITE_ITEMS_KEY, nextItems);
    saveStoredArray(FAVORITES_KEY, nextSlugs);
    set({
      favorites: nextIds,
      guestFavoriteItems: nextItems,
      favoriteSlugs: nextSlugs,
    });
    return true;
  },

  clearGuestFavorites: () => {
    saveStoredArray(FAVORITE_IDS_KEY, []);
    saveStoredArray(FAVORITE_ITEMS_KEY, []);
    saveStoredArray(FAVORITES_KEY, []);
    set({
      favorites: [],
      guestFavoriteItems: [],
      favoriteSlugs: [],
    });
  },

  toggleCompareItem: (item) => {
    const current = get().compareItems;
    const exists = current.some((p) => p.id === item.id);
    let next: ProductSummaryDTO[];
    if (exists) {
      next = current.filter((p) => p.id !== item.id);
    } else if (current.length >= 3) {
      next = [...current.slice(1), item];
    } else {
      next = [...current, item];
    }
    saveStoredArray(COMPARE_KEY, next);
    set({ compareItems: next });
  },

  removeCompareItem: (id) => {
    const next = get().compareItems.filter((p) => p.id !== id);
    saveStoredArray(COMPARE_KEY, next);
    set({
      compareItems: next,
      compareModalOpen: next.length === 0 ? false : get().compareModalOpen,
    });
  },

  clearCompare: () => {
    saveStoredArray(COMPARE_KEY, []);
    set({ compareItems: [], compareModalOpen: false });
  },
  };
});
