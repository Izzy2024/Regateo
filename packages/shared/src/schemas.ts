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
    slug: "fotosonido",
    name: "Foto Sonido PTY",
    baseUrl: "https://www.fotosonidopty.com",
    platform: "firecrawl-html",
    color: "#7C3AED",
    accentBg: "#F5F3FF",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: [
      "/categoria-producto/televisores/",
      "/categoria-producto/linea-blanca/",
      "/categoria-producto/audio/",
      "/categoria-producto/computadoras/",
      "/",
    ],
    description: "Televisores, línea blanca, aires acondicionados y audio.",
  },
  {
    slug: "audiofoto",
    name: "Audiofoto",
    baseUrl: "https://audiofotopro.com",
    platform: "firecrawl-html",
    color: "#0369A1",
    accentBg: "#F0F9FF",
    country: "PA",
    currency: "USD",
    enabled: true,
    scrapePaths: ["/", "/productos/"],
    description: "Audio profesional, video, fotografía y electrónica.",
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
      "best-savings",
      "price-asc",
      "price-desc",
      "most-stores",
      "recent",
    ])
    .default("best-savings"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

export const createPriceAlertSchema = z.object({
  productId: z.string().uuid(),
  email: z.string().email("Ingresa un correo electrónico válido"),
  targetPriceCents: z.number().int().positive("El precio objetivo debe ser mayor a $0"),
});

export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;

export const triggerScrapeSchema = z.object({
  stores: z.array(z.string().min(1)).optional(),
  maxPerStore: z.number().int().min(1).max(200).default(40),
  useFirecrawl: z.boolean().default(true),
});

export type TriggerScrapeInput = z.infer<typeof triggerScrapeSchema>;

export const aiChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(30),
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
  savingsCents: number;
  savingsPercent: number;
  storeCount: number;
  inStockCount: number;
  bestStore: {
    slug: string;
    name: string;
    color: string;
    url: string;
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

export interface ProductDetailDTO extends ProductSummaryDTO {
  specs: Record<string, unknown> | null;
  priceHistory: PriceHistoryPointDTO[];
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
