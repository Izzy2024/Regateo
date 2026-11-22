import { z } from "zod";

export const PRODUCT_CATEGORIES = [
  "computadoras",
  "celulares",
  "televisores",
  "linea-blanca",
  "audio",
  "perifericos",
  "gaming",
  "aires-acondicionados",
  "electrodomesticos",
  "accesorios",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  computadoras: "Computadoras & Laptops",
  celulares: "Celulares & Tablets",
  televisores: "Televisores",
  "linea-blanca": "Línea Blanca",
  audio: "Audio & Sonido",
  perifericos: "Mouse & Periféricos",
  gaming: "Gaming & Consolas",
  "aires-acondicionados": "Aires Acondicionados",
  electrodomesticos: "Electrodomésticos",
  accesorios: "Accesorios",
};

export const STORE_PLATFORMS = [
  "shopify",
  "magento",
  "firecrawl-html",
  "custom",
] as const;

export type StorePlatform = (typeof STORE_PLATFORMS)[number];

export interface PanamaStoreConfig {
  slug: string;
  name: string;
  baseUrl: string;
  platform: StorePlatform;
  color: string;
  accentBg: string;
  country: "PA";
  currency: "USD";
  enabled: boolean;
  scrapePaths: string[];
  description: string;
}

export const PANAMA_STORES: PanamaStoreConfig[] = [
  {
    slug: "multimax",
    name: "Multimax",
    baseUrl: "https://www.multimax.net",
    platform: "shopify",
    color: "#E11D48",
    accentBg: "#FFF1F2",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/collections/computadoras/products.json",
      "/collections/televisores/products.json",
      "/collections/linea-blanca/products.json",
      "/collections/audio/products.json",
      "/collections/celulares/products.json",
      "/products.json",
    ],
    description: "Electrónica, cómputo, línea blanca y audio en Panamá.",
  },
  {
    slug: "panafoto",
    name: "Panafoto",
    baseUrl: "https://www.panafoto.com",
    platform: "magento",
    color: "#1D4ED8",
    accentBg: "#EFF6FF",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/categorias/computadoras.html",
      "/categorias/televisores.html",
      "/categorias/linea-blanca.html",
      "/categorias/celulares.html",
      "/categorias/audio.html",
    ],
    description: "Tecnología, fotografía, TV, laptops y electrodomésticos.",
  },
  {
    slug: "rodelag",
    name: "Rodelag",
    baseUrl: "https://rodelag.com",
    platform: "shopify",
    color: "#EA580C",
    accentBg: "#FFF7ED",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/collections/linea-blanca/products.json",
      "/collections/tecnologia/products.json",
      "/collections/televisores/products.json",
      "/collections/electrodomesticos/products.json",
      "/products.json",
    ],
    description: "Línea blanca, televisores, tecnología y hogar en Panamá.",
  },
  {
    slug: "titan",
    name: "Almacenes Titán",
    baseUrl: "https://titan.com.pa",
    platform: "shopify",
    color: "#0F766E",
    accentBg: "#F0FDFA",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/collections/electronica/products.json",
      "/collections/electrodomesticos/products.json",
      "/collections/tecnologia/products.json",
      "/products.json",
    ],
    description: "Electrodomésticos, electrónica, accesorios y hogar.",
  },
  {
    slug: "photura",
    name: "Photura",
    baseUrl: "https://www.photura.com",
    platform: "shopify",
    color: "#0284C7",
    accentBg: "#F0F9FF",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/collections/televisores/products.json",
      "/collections/computacion/products.json",
      "/collections/celulares-tablets/products.json",
      "/collections/audio/products.json",
      "/collections/refrigeradoras/products.json",
      "/collections/aires-acondicionados/products.json",
      "/collections/teclados-mouse/products.json",
      "/products.json",
    ],
    description: "Televisores, computación, audio, fotografía, aires y línea blanca en Panamá.",
  },
  {
    slug: "doitcenter",
    name: "Do it Center",
    baseUrl: "https://www.doitcenter.com.pa",
    platform: "firecrawl-html",
    color: "#DC2626",
    accentBg: "#FEF2F2",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/categorias/electrodomesticos",
      "/categorias/tecnologia",
      "/categorias/linea-blanca",
      "/categorias/aires-acondicionados",
    ],
    description: "Electrodomésticos, línea blanca, aires acondicionados y tecnología en Panamá.",
  },
  {
    slug: "yoytec",
    name: "Yoytec",
    baseUrl: "https://www.yoytec.com",
    platform: "firecrawl-html",
    color: "#2563EB",
    accentBg: "#EFF6FF",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/shop",
      "/shop/page/2",
      "/shop/page/3",
    ],
    description: "Computadoras, componentes PC, periféricos gamer, mouse, monitores y redes en Panamá.",
  },
  {
    slug: "ptytec",
    name: "PTYTEC",
    baseUrl: "https://www.ptytec.com",
    platform: "firecrawl-html",
    color: "#0D9488",
    accentBg: "#F0FDFA",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: ["/"],
    description: "Laptops, PCs gamer, mouse, teclados, monitores y tecnología en Panamá.",
  },
];

export const productCategorySchema = z.enum(PRODUCT_CATEGORIES);

export const productSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: productCategorySchema.optional(),
  store: z.string().trim().max(64).optional(),
  brand: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStockOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  multiStoreOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  sort: z
    .enum([
      "relevance",
      "most-stores",
      "best-savings",
      "price-asc",
      "price-desc",
      "recent",
    ])
    .default("most-stores"),
  page: z.coerce.number().int().min(1).max(50).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

export const createPriceAlertSchema = z.object({
  productId: z.string().uuid(),
  email: z.string().email("Ingresa un correo electrónico válido"),
  targetPriceCents: z.number().int().positive("El precio objetivo debe ser mayor a $0"),
});

export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;

export const reportWrongPriceSchema = z.object({
  productId: z.string().uuid(),
  listingId: z.string().uuid(),
  reason: z.enum(["wrong-price", "out-of-stock", "wrong-match", "broken-link"]),
  details: z.string().trim().max(300).optional(),
});

export type ReportWrongPriceInput = z.infer<typeof reportWrongPriceSchema>;

export const triggerScrapeSchema = z.object({
  stores: z.array(z.string().min(1)).optional(),
  maxPerStore: z.number().int().min(1).max(20000).default(5000),
  useFirecrawl: z.boolean().default(true),
});

export type TriggerScrapeInput = z.infer<typeof triggerScrapeSchema>;

export const aiChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(1500),
      })
    )
    .min(1)
    .max(12),
});

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const scrapedItemSchema = z.object({
  storeSlug: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().min(2),
  brand: z.string().nullable().optional(),
  modelNumber: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  category: productCategorySchema.optional(),
  priceCents: z.number().int().positive(),
  originalPriceCents: z.number().int().positive().nullable().optional(),
  currency: z.literal("USD").default("USD"),
  inStock: z.boolean().default(true),
  url: z.string().url(),
  imageUrl: z.string().url().nullable().optional(),
  rawSpecs: z.record(z.string(), z.unknown()).optional(),
});

export type ScrapedItem = z.infer<typeof scrapedItemSchema>;

export interface StoreListingDTO {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  storeColor: string;
  storeAccentBg: string;
  titleAtStore: string;
  priceCents: number;
  originalPriceCents: number | null;
  currency: string;
  inStock: boolean;
  color?: string | null;
  url: string;
  imageUrl: string | null;
  lastCheckedAt: string;
  isCheapest: boolean;
  deltaFromCheapestCents: number;
}

export interface ProductSummaryDTO {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: ProductCategory;
  imageUrl: string | null;
  bestPriceCents: number;
  highestPriceCents: number;
  /** Ahorro verificable entre tiendas en stock (0 si solo hay 1 tienda con stock). */
  savingsCents: number;
  /** Porcentaje de ahorro real entre tiendas (0..99%, nunca >100%). */
  savingsPercent: number;
  /** Descuento anunciado por la tienda ganadora sobre su propio precio original (tope 65% si no está verificado). */
  storeDiscountCents?: number;
  storeDiscountPercent?: number;
  storeCount: number;
  inStockCount: number;
  bestStore: {
    slug: string;
    name: string;
    color: string;
    url: string;
    listingId?: string;
    inStock?: boolean;
  } | null;
  listings: StoreListingDTO[];
  updatedAt: string;
}

export interface PriceHistoryPointDTO {
  date: string;
  storeSlug: string;
  storeName: string;
  storeColor: string;
  priceCents: number;
}

export interface SimilarProductDTO {
  id: string;
  slug: string;
  canonicalName: string;
  brand: string | null;
  modelNumber: string | null;
  category: ProductCategory;
  imageUrl: string | null;
  bestPriceCents: number;
  priceDiffCents: number;
  priceDiffPercent: number;
  similarityScore: number;
  matchReasons: string[];
  storeCount: number;
  bestStore: {
    slug: string;
    name: string;
    color: string;
    accentBg: string;
    url: string;
    inStock: boolean;
  };
}

export interface PriceInsightDTO {
  daysTracked: number;
  historicalLowCents: number | null;
  historicalHighCents: number | null;
  historicalAvgCents: number | null;
  fakeDiscountFlag: boolean;
  fakeDiscountNote: string | null;
  buyAdvice: "buy-now" | "fair-price" | "wait" | "collecting-history";
  buyAdviceLabel: string;
}

export interface ProductDetailDTO extends ProductSummaryDTO {
  specs: Record<string, unknown> | null;
  priceHistory: PriceHistoryPointDTO[];
  similarProducts?: SimilarProductDTO[];
  priceInsight?: PriceInsightDTO;
}

export interface BuyingGuideDTO {
  slug: string;
  title: string;
  subtitle: string;
  category: ProductCategory | null;
  maxPriceUsd: number | null;
  updatedAt: string;
  itemCount: number;
  items: ProductSummaryDTO[];
}

export interface AnalyticsSummaryDTO {
  periodDays: number;
  outboundClicksTotal: number;
  outboundClicksByStore: Array<{ storeSlug: string; storeName: string; clicks: number }>;
  topClickedProducts: Array<{
    productId: string;
    slug: string;
    canonicalName: string;
    clicks: number;
  }>;
  topSearches: Array<{ query: string; count: number; avgResults: number }>;
  zeroResultSearches: Array<{ query: string; count: number }>;
  openPriceReportsCount: number;
  totalProducts: number;
  multiStoreProducts: number;
  multiStoreCoveragePct: number;
}

export interface StoreStatusDTO {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  platform: StorePlatform;
  color: string;
  accentBg: string;
  enabled: boolean;
  listingCount: number;
  lastScrapedAt: string | null;
  lastRunStatus: string | null;
  lastRunItems: number;
}

// ============================================================================
// Mi Espacio (Usuario Logueado): Favoritos, Alertas y Listas/Presupuestos
// ============================================================================

export const createFavoriteSchema = z.object({
  productId: z.string().uuid(),
  note: z.string().trim().max(240).optional(),
});

export type CreateFavoriteInput = z.infer<typeof createFavoriteSchema>;

export const syncFavoritesSchema = z.object({
  productIds: z.array(z.string().uuid()).max(100),
});

export type SyncFavoritesInput = z.infer<typeof syncFavoritesSchema>;

export const createShoppingListSchema = z.object({
  name: z.string().trim().min(2, "Ingresa un nombre de al menos 2 caracteres").max(80),
  description: z.string().trim().max(240).optional(),
});

export type CreateShoppingListInput = z.infer<typeof createShoppingListSchema>;

export const addListItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20).default(1),
});

export type AddListItemInput = z.infer<typeof addListItemSchema>;

export const updateAlertSchema = z.object({
  targetPriceCents: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;

export interface FavoriteProductDTO {
  id: string;
  productId: string;
  savedPriceCents: number;
  currentBestPriceCents: number;
  priceChangeSinceSavedCents: number; // < 0 significa que bajó de precio desde que lo guardaste
  note: string | null;
  createdAt: string;
  product: ProductSummaryDTO;
}

export interface ShoppingListItemDTO {
  id: string;
  productId: string;
  quantity: number;
  createdAt: string;
  product: ProductSummaryDTO;
}

export interface ShoppingListDTO {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  itemCount: number;
  totalBestPriceCents: number;
  totalHighestPriceCents: number;
  totalSavingsCents: number;
  items: ShoppingListItemDTO[];
}

export interface UserAlertDTO {
  id: string;
  productId: string;
  email: string;
  targetPriceCents: number;
  active: boolean;
  createdAt: string;
  reachedTarget: boolean;
  product: {
    id: string;
    slug: string;
    canonicalName: string;
    brand: string | null;
    imageUrl: string | null;
    currentBestPriceCents: number | null;
    bestStoreName: string | null;
    bestStoreUrl: string | null;
  };
}

export interface UserOverviewDTO {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  stats: {
    favoritesCount: number;
    activeAlertsCount: number;
    reachedAlertsCount: number;
    listsCount: number;
    priceDropsSinceSavedCount: number;
    totalPotentialSavingsCents: number;
  };
  favorites: FavoriteProductDTO[];
  alerts: UserAlertDTO[];
  lists: ShoppingListDTO[];
}
