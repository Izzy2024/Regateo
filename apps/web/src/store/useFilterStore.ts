import type { ProductCategory, ProductSearchQuery, ProductSummaryDTO } from "@regateo/shared";
import { create } from "zustand";

export type AppView =
  | "catalogo"
  | "ofertas"
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
  const params = new URLSearchParams(window.location.search);
  return params.get("producto");
}

function readInitialView(): AppView {
  if (typeof window === "undefined") return "catalogo";
  const params = new URLSearchParams(window.location.search);
  const vista = params.get("vista");
  if (
    vista === "ofertas" ||
    vista === "tiendas" ||
    vista === "catalogo" ||
    vista === "mi-espacio" ||
    vista === "privacidad"
  ) {
    return vista;
  }
  return "catalogo";
}

function syncUrlParams(updates: { producto?: string | null; vista?: AppView }) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);

  if (updates.producto !== undefined) {
    if (updates.producto) {
      url.searchParams.set("producto", updates.producto);
    } else {
      url.searchParams.delete("producto");
    }
  }

  if (updates.vista !== undefined) {
    if (updates.vista === "catalogo") {
      url.searchParams.delete("vista");
    } else {
      url.searchParams.set("vista", updates.vista);
    }
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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

export const useFilterStore = create<FilterState>((set, get) => ({
  activeView: readInitialView(),
  selectedProductSlug: readInitialProductSlug(),
  aiOpen: false,
  aiInitialPrompt: null,
  authOpen: false,
  authMode: "signin",
  authHint: null,
  compareModalOpen: false,
  mobileFiltersOpen: false,

  q: "",
  category: undefined,
  store: undefined,
  brand: undefined,
  minPrice: undefined,
  maxPrice: undefined,
  inStockOnly: false,
  multiStoreOnly: false,
  sort: "best-savings",
  page: 1,
  limit: 24,

  favorites: loadStoredArray<string>(FAVORITE_IDS_KEY),
  guestFavoriteItems: loadStoredArray<GuestFavoriteSummary>(FAVORITE_ITEMS_KEY),
  favoriteSlugs: loadStoredArray<string>(FAVORITES_KEY),
  compareItems: loadStoredArray<ProductSummaryDTO>(COMPARE_KEY).slice(0, 3),

  setActiveView: (view) => {
    syncUrlParams({ vista: view });
    set({ activeView: view });
  },

  openProduct: (slug) => {
    syncUrlParams({ producto: slug });
    set({ selectedProductSlug: slug });
  },

  closeProduct: () => {
    syncUrlParams({ producto: null });
    set({ selectedProductSlug: null });
  },

  syncFromLocation: () => {
    set({
      selectedProductSlug: readInitialProductSlug(),
      activeView: readInitialView(),
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

  setQuery: (q) => set({ q, page: 1 }),
  setCategory: (category) => set({ category, page: 1 }),
  setStore: (store) => set({ store, page: 1 }),
  setBrand: (brand) => set({ brand, page: 1 }),
  setPriceRange: (minPrice, maxPrice) => set({ minPrice, maxPrice, page: 1 }),
  setInStockOnly: (inStockOnly) => set({ inStockOnly, page: 1 }),
  setMultiStoreOnly: (multiStoreOnly) => set({ multiStoreOnly, page: 1 }),
  setSort: (sort) => set({ sort, page: 1 }),
  setPage: (page) => set({ page }),

  resetFilters: () =>
    set({
      q: "",
      category: undefined,
      store: undefined,
      brand: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      inStockOnly: false,
      multiStoreOnly: false,
      sort: "best-savings",
      page: 1,
    }),

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
}));
