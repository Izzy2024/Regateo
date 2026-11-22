import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ============================================================================
// Better Auth core tables (PostgreSQL + Drizzle adapter compatible)
// ============================================================================
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("user_email_idx").on(table.email)]
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_idx").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

// ============================================================================
// RegateoApp Domain Tables (Indexed on every FK and frequent filter column)
// ============================================================================

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    baseUrl: text("base_url").notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("shopify"),
    color: varchar("color", { length: 24 }).notNull().default("#0F172A"),
    accentBg: varchar("accent_bg", { length: 24 }).notNull().default("#F8FAFC"),
    country: varchar("country", { length: 8 }).notNull().default("PA"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    enabled: boolean("enabled").notNull().default(true),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stores_slug_uidx").on(table.slug),
    index("stores_enabled_idx").on(table.enabled),
  ]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull(),
    matchKey: varchar("match_key", { length: 180 }).notNull(),
    canonicalName: text("canonical_name").notNull(),
    brand: varchar("brand", { length: 80 }),
    modelNumber: varchar("model_number", { length: 96 }),
    category: varchar("category", { length: 48 }).notNull().default("accesorios"),
    imageUrl: text("image_url"),
    specs: jsonb("specs").$type<Record<string, unknown>>(),
    // pgvector HNSW column is enabled in Neon/Supabase via migrations/pgvector-hnsw.sql
    embeddingText: text("embedding_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_slug_uidx").on(table.slug),
    uniqueIndex("products_match_key_uidx").on(table.matchKey),
    index("products_category_idx").on(table.category),
    index("products_brand_idx").on(table.brand),
    index("products_model_number_idx").on(table.modelNumber),
    index("products_updated_at_idx").on(table.updatedAt),
  ]
);

export const storeListings = pgTable(
  "store_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 160 }).notNull(),
    titleAtStore: text("title_at_store").notNull(),
    priceCents: integer("price_cents").notNull(),
    originalPriceCents: integer("original_price_cents"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    inStock: boolean("in_stock").notNull().default(true),
    url: text("url").notNull(),
    imageUrl: text("image_url"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_listings_store_ext_uidx").on(table.storeId, table.externalId),
    index("store_listings_product_id_idx").on(table.productId),
    index("store_listings_store_id_idx").on(table.storeId),
    index("store_listings_price_cents_idx").on(table.priceCents),
    index("store_listings_in_stock_idx").on(table.inStock),
    index("store_listings_product_price_idx").on(table.productId, table.priceCents),
  ]
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => storeListings.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    inStock: boolean("in_stock").notNull().default(true),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("price_history_listing_id_idx").on(table.listingId),
    index("price_history_recorded_at_idx").on(table.recordedAt),
    index("price_history_listing_recorded_idx").on(table.listingId, table.recordedAt),
  ]
);

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    storeSlug: varchar("store_slug", { length: 64 }).notNull(),
    engine: varchar("engine", { length: 32 }).notNull().default("firecrawl"),
    status: varchar("status", { length: 24 }).notNull().default("running"),
    itemsFound: integer("items_found").notNull().default(0),
    itemsUpserted: integer("items_upserted").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("scrape_runs_store_id_idx").on(table.storeId),
    index("scrape_runs_store_slug_idx").on(table.storeSlug),
    index("scrape_runs_started_at_idx").on(table.startedAt),
    index("scrape_runs_status_idx").on(table.status),
  ]
);

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: varchar("email", { length: 255 }).notNull(),
    targetPriceCents: integer("target_price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    verified: boolean("verified").notNull().default(false),
    confirmToken: varchar("confirm_token", { length: 96 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("price_alerts_product_id_idx").on(table.productId),
    index("price_alerts_user_id_idx").on(table.userId),
    index("price_alerts_email_idx").on(table.email),
    index("price_alerts_active_idx").on(table.active),
    index("price_alerts_confirm_token_idx").on(table.confirmToken),
  ]
);

export const userFavorites = pgTable(
  "user_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    savedPriceCents: integer("saved_price_cents").notNull(),
    note: varchar("note", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_favorites_user_product_uidx").on(table.userId, table.productId),
    index("user_favorites_user_id_idx").on(table.userId),
    index("user_favorites_product_id_idx").on(table.productId),
  ]
);

export const userLists = pgTable(
  "user_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_lists_user_id_idx").on(table.userId),
  ]
);

export const userListItems = pgTable(
  "user_list_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listId: uuid("list_id")
      .notNull()
      .references(() => userLists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_list_items_list_product_uidx").on(table.listId, table.productId),
    index("user_list_items_list_id_idx").on(table.listId),
    index("user_list_items_product_id_idx").on(table.productId),
  ]
);

export const outboundClicks = pgTable(
  "outbound_clicks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => storeListings.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    storeSlug: varchar("store_slug", { length: 64 }).notNull(),
    source: varchar("source", { length: 32 }).notNull().default("card"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbound_clicks_listing_id_idx").on(table.listingId),
    index("outbound_clicks_product_id_idx").on(table.productId),
    index("outbound_clicks_store_id_idx").on(table.storeId),
    index("outbound_clicks_created_at_idx").on(table.createdAt),
  ]
);

export const priceReports = pgTable(
  "price_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => storeListings.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 32 }).notNull(),
    details: varchar("details", { length: 300 }),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("price_reports_product_id_idx").on(table.productId),
    index("price_reports_listing_id_idx").on(table.listingId),
    index("price_reports_status_idx").on(table.status),
  ]
);

export const searchEvents = pgTable(
  "search_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    query: varchar("query", { length: 200 }).notNull(),
    category: varchar("category", { length: 48 }),
    resultsCount: integer("results_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("search_events_created_at_idx").on(table.createdAt),
    index("search_events_query_idx").on(table.query),
  ]
);
