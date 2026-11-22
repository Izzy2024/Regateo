// ============================================================================
// Servicio "Mi Espacio" (Sprint 4) — favoritos, listas de compra/presupuestos
// y alertas del usuario autenticado, hidratando ProductSummaryDTO reales vía
// los helpers de catalog.ts.
// ============================================================================
import {
  db,
  and,
  desc,
  eq,
  inArray,
  or,
  sql,
  products,
  storeListings,
  priceAlerts,
  userFavorites,
  userLists,
  userListItems,
} from "@regateo/db";
import type {
  AddListItemInput,
  CreateFavoriteInput,
  CreateShoppingListInput,
  FavoriteProductDTO,
  ProductSummaryDTO,
  ShoppingListDTO,
  ShoppingListItemDTO,
  SyncFavoritesInput,
  UpdateAlertInput,
  UserAlertDTO,
  UserOverviewDTO,
} from "@regateo/shared";
import {
  bestPriceForProduct,
  hydrateProductSummaries,
} from "./catalog";

export interface MeUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

function toIso(value: Date | string | null | undefined): string {
  return (value instanceof Date ? value.toISOString() : new Date(value as string).toISOString());
}

function alertOwnerFilter(user: MeUser) {
  return or(
    eq(priceAlerts.userId, user.id),
    sql`lower(${priceAlerts.email}) = ${user.email.toLowerCase()}`
  );
}

// ---------------------------------------------------------------------------
// Alertas del usuario hidratadas (reusable por overview y GET /api/alerts)
// ---------------------------------------------------------------------------
export async function listUserAlerts(user: MeUser): Promise<UserAlertDTO[]> {
  const alertRows = await db
    .select()
    .from(priceAlerts)
    .where(alertOwnerFilter(user))
    .orderBy(desc(priceAlerts.createdAt))
    .limit(100);

  const summaries = await hydrateProductSummaries(
    alertRows.map((row) => row.productId)
  );
  const missingIds = alertRows
    .map((row) => row.productId)
    .filter((id) => !summaries.has(id));
  const minimalRows =
    missingIds.length > 0
      ? await db
          .select({
            id: products.id,
            slug: products.slug,
            canonicalName: products.canonicalName,
            brand: products.brand,
            imageUrl: products.imageUrl,
          })
          .from(products)
          .where(inArray(products.id, missingIds))
      : [];
  const minimalById = new Map(minimalRows.map((row) => [row.id, row]));

  return alertRows.map((row) => {
    const summary = summaries.get(row.productId);
    const minimal = minimalById.get(row.productId);
    const currentBest = summary?.bestPriceCents ?? null;
    return {
      id: row.id,
      productId: row.productId,
      email: row.email,
      targetPriceCents: row.targetPriceCents,
      active: row.active,
      createdAt: toIso(row.createdAt),
      reachedTarget:
        currentBest !== null && currentBest <= row.targetPriceCents && row.active,
      product: {
        id: row.productId,
        slug: summary?.slug ?? minimal?.slug ?? "",
        canonicalName: summary?.canonicalName ?? minimal?.canonicalName ?? "",
        brand: summary?.brand ?? minimal?.brand ?? null,
        imageUrl: summary?.imageUrl ?? minimal?.imageUrl ?? null,
        currentBestPriceCents: currentBest,
        bestStoreName: summary?.bestStore?.name ?? null,
        bestStoreUrl: summary?.bestStore?.url ?? null,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Overview: favoritos + alertas + listas + stats agregadas
// ---------------------------------------------------------------------------
export async function getUserOverview(user: MeUser): Promise<UserOverviewDTO> {
  const favoriteRows = await db
    .select()
    .from(userFavorites)
    .where(eq(userFavorites.userId, user.id))
    .orderBy(desc(userFavorites.createdAt));

  const alertRows = await db
    .select()
    .from(priceAlerts)
    .where(alertOwnerFilter(user))
    .orderBy(desc(priceAlerts.createdAt));

  const listRows = await db
    .select()
    .from(userLists)
    .where(eq(userLists.userId, user.id))
    .orderBy(desc(userLists.createdAt));

  const listIds = listRows.map((list) => list.id);
  const itemRows =
    listIds.length > 0
      ? await db.select().from(userListItems).where(inArray(userListItems.listId, listIds))
      : [];

  // Hidratación en bloque de todos los productos referenciados
  const allProductIds = new Set<string>([
    ...favoriteRows.map((row) => row.productId),
    ...alertRows.map((row) => row.productId),
    ...itemRows.map((row) => row.productId),
  ]);
  const summaries = await hydrateProductSummaries([...allProductIds]);

  // ---- Favoritos con delta de precio desde que se guardaron
  const favorites: FavoriteProductDTO[] = [];
  for (const row of favoriteRows) {
    const summary = summaries.get(row.productId);
    if (!summary) continue; // descatalogado sin listings: se omite del overview
    favorites.push({
      id: row.id,
      productId: row.productId,
      savedPriceCents: row.savedPriceCents,
      currentBestPriceCents: summary.bestPriceCents,
      priceChangeSinceSavedCents: summary.bestPriceCents - row.savedPriceCents,
      note: row.note ?? null,
      createdAt: toIso(row.createdAt),
      product: summary,
    });
  }

  // ---- Alertas con reachedTarget (misma forma que listUserAlerts)
  const alerts: UserAlertDTO[] = alertRows.map((row) => {
    const summary = summaries.get(row.productId);
    const currentBest = summary?.bestPriceCents ?? null;
    return {
      id: row.id,
      productId: row.productId,
      email: row.email,
      targetPriceCents: row.targetPriceCents,
      active: row.active,
      createdAt: toIso(row.createdAt),
      reachedTarget:
        currentBest !== null && currentBest <= row.targetPriceCents && row.active,
      product: {
        id: row.productId,
        slug: summary?.slug ?? "",
        canonicalName: summary?.canonicalName ?? "",
        brand: summary?.brand ?? null,
        imageUrl: summary?.imageUrl ?? null,
        currentBestPriceCents: currentBest,
        bestStoreName: summary?.bestStore?.name ?? null,
        bestStoreUrl: summary?.bestStore?.url ?? null,
      },
    };
  });

  // ---- Listas con totales (best/highest/ahorro por cantidad)
  const lists: ShoppingListDTO[] = listRows.map((list) => {
    const items = itemRows.filter((item) => item.listId === list.id);
    const hydrated: ShoppingListItemDTO[] = [];
    let totalBestPriceCents = 0;
    let totalHighestPriceCents = 0;
    for (const item of items) {
      const summary = summaries.get(item.productId);
      if (!summary) continue;
      hydrated.push({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        createdAt: toIso(item.createdAt),
        product: summary,
      });
      totalBestPriceCents += summary.bestPriceCents * item.quantity;
      totalHighestPriceCents += summary.highestPriceCents * item.quantity;
    }
    return {
      id: list.id,
      name: list.name,
      description: list.description ?? null,
      createdAt: toIso(list.createdAt),
      itemCount: hydrated.length,
      totalBestPriceCents,
      totalHighestPriceCents,
      totalSavingsCents: Math.max(0, totalHighestPriceCents - totalBestPriceCents),
      items: hydrated,
    };
  });

  const priceDropsSinceSavedCount = favorites.filter(
    (favorite) => favorite.priceChangeSinceSavedCents < 0
  ).length;
  const activeAlerts = alerts.filter((alert) => alert.active);
  const favoritesPotentialCents = favorites.reduce(
    (total, favorite) =>
      total + Math.max(0, favorite.savedPriceCents - favorite.currentBestPriceCents),
    0
  );
  const listsPotentialCents = lists.reduce(
    (total, list) => total + list.totalSavingsCents,
    0
  );

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    },
    stats: {
      favoritesCount: favorites.length,
      activeAlertsCount: activeAlerts.length,
      reachedAlertsCount: activeAlerts.filter((alert) => alert.reachedTarget).length,
      listsCount: lists.length,
      priceDropsSinceSavedCount,
      totalPotentialSavingsCents: favoritesPotentialCents + listsPotentialCents,
    },
    favorites,
    alerts,
    lists,
  };
}

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------
export interface FavoriteRecord {
  id: string;
  userId: string;
  productId: string;
  savedPriceCents: number;
  note: string | null;
  createdAt: string;
}

function serializeFavorite(row: typeof userFavorites.$inferSelect): FavoriteRecord {
  return {
    id: row.id,
    userId: row.userId,
    productId: row.productId,
    savedPriceCents: row.savedPriceCents,
    note: row.note ?? null,
    createdAt: toIso(row.createdAt),
  };
}

export async function addUserFavorite(
  userId: string,
  input: CreateFavoriteInput
): Promise<FavoriteRecord | null> {
  const [productRow] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!productRow) return null;

  const savedPriceCents = (await bestPriceForProduct(input.productId)) ?? 0;
  const [row] = await db
    .insert(userFavorites)
    .values({
      userId,
      productId: input.productId,
      savedPriceCents,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [userFavorites.userId, userFavorites.productId],
      set: { savedPriceCents, note: input.note ?? null },
    })
    .returning();

  return row ? serializeFavorite(row) : null;
}

export async function removeUserFavorite(
  userId: string,
  productId: string
): Promise<boolean> {
  const removed = await db
    .delete(userFavorites)
    .where(
      and(eq(userFavorites.userId, userId), eq(userFavorites.productId, productId))
    )
    .returning({ id: userFavorites.id });
  return removed.length > 0;
}

/** Migra favoritos de invitado (localStorage) al iniciar sesión, en bloque. */
export async function syncUserFavorites(
  userId: string,
  input: SyncFavoritesInput
): Promise<{ added: number; skipped: number }> {
  const uniqueIds = [...new Set(input.productIds)];
  if (uniqueIds.length === 0) return { added: 0, skipped: 0 };

  const priceRows = await db
    .select({
      productId: storeListings.productId,
      best: sql<number>`min(${storeListings.priceCents})::int`,
    })
    .from(storeListings)
    .where(inArray(storeListings.productId, uniqueIds))
    .groupBy(storeListings.productId);

  const withPrice = priceRows.filter((row) => row.best > 0);
  if (withPrice.length === 0) return { added: 0, skipped: uniqueIds.length };

  const existing = await db
    .select({ productId: userFavorites.productId })
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.userId, userId),
        inArray(userFavorites.productId, withPrice.map((row) => row.productId))
      )
    );
  const existingIds = new Set(existing.map((row) => row.productId));

  // onConflictDoNothing preserva savedPriceCents de los favoritos ya guardados
  await db
    .insert(userFavorites)
    .values(
      withPrice.map((row) => ({
        userId,
        productId: row.productId,
        savedPriceCents: row.best,
      }))
    )
    .onConflictDoNothing({
      target: [userFavorites.userId, userFavorites.productId],
    });

  const added = withPrice.filter((row) => !existingIds.has(row.productId)).length;
  return { added, skipped: uniqueIds.length - added };
}

// ---------------------------------------------------------------------------
// Listas de compra / presupuestos
// ---------------------------------------------------------------------------
export async function createUserList(
  userId: string,
  input: CreateShoppingListInput
): Promise<ShoppingListDTO> {
  const [list] = await db
    .insert(userLists)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();

  return {
    id: list.id,
    name: list.name,
    description: list.description ?? null,
    createdAt: toIso(list.createdAt),
    itemCount: 0,
    totalBestPriceCents: 0,
    totalHighestPriceCents: 0,
    totalSavingsCents: 0,
    items: [],
  };
}

export async function deleteUserList(userId: string, listId: string): Promise<boolean> {
  const removed = await db
    .delete(userLists)
    .where(and(eq(userLists.id, listId), eq(userLists.userId, userId)))
    .returning({ id: userLists.id });
  return removed.length > 0;
}

async function ownedList(userId: string, listId: string) {
  const [list] = await db
    .select({ id: userLists.id })
    .from(userLists)
    .where(and(eq(userLists.id, listId), eq(userLists.userId, userId)))
    .limit(1);
  return list ?? null;
}

export async function addItemToUserList(
  userId: string,
  listId: string,
  input: AddListItemInput
): Promise<ShoppingListItemDTO | null> {
  const list = await ownedList(userId, listId);
  if (!list) return null;

  const [productRow] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!productRow) return null;

  // Upsert de cantidad: si ya estaba en la lista, se reemplaza la cantidad
  const [item] = await db
    .insert(userListItems)
    .values({ listId, productId: input.productId, quantity: input.quantity })
    .onConflictDoUpdate({
      target: [userListItems.listId, userListItems.productId],
      set: { quantity: input.quantity },
    })
    .returning();

  await db
    .update(userLists)
    .set({ updatedAt: new Date() })
    .where(eq(userLists.id, listId));

  const summaries = await hydrateProductSummaries([input.productId]);
  const summary: ProductSummaryDTO | undefined = summaries.get(input.productId);
  if (!summary) return null;

  return {
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    createdAt: toIso(item.createdAt),
    product: summary,
  };
}

export async function removeItemFromUserList(
  userId: string,
  listId: string,
  productId: string
): Promise<boolean> {
  const list = await ownedList(userId, listId);
  if (!list) return false;

  const removed = await db
    .delete(userListItems)
    .where(
      and(eq(userListItems.listId, listId), eq(userListItems.productId, productId))
    )
    .returning({ id: userListItems.id });
  return removed.length > 0;
}

// ---------------------------------------------------------------------------
// Alertas del usuario (propiedad por userId O email)
// ---------------------------------------------------------------------------
export interface UserAlertRecord {
  id: string;
  productId: string;
  email: string;
  targetPriceCents: number;
  active: boolean;
  createdAt: string;
}

function serializeAlert(row: typeof priceAlerts.$inferSelect): UserAlertRecord {
  return {
    id: row.id,
    productId: row.productId,
    email: row.email,
    targetPriceCents: row.targetPriceCents,
    active: row.active,
    createdAt: toIso(row.createdAt),
  };
}

export async function updateUserAlert(
  user: MeUser,
  alertId: string,
  input: UpdateAlertInput
): Promise<UserAlertRecord | null> {
  const [alert] = await db
    .select()
    .from(priceAlerts)
    .where(and(eq(priceAlerts.id, alertId), alertOwnerFilter(user)))
    .limit(1);
  if (!alert) return null;

  const patch: { targetPriceCents?: number; active?: boolean } = {};
  if (input.targetPriceCents !== undefined) {
    patch.targetPriceCents = input.targetPriceCents;
  }
  if (input.active !== undefined) {
    patch.active = input.active;
  }

  if (Object.keys(patch).length === 0) return serializeAlert(alert);

  const [updated] = await db
    .update(priceAlerts)
    .set(patch)
    .where(eq(priceAlerts.id, alertId))
    .returning();
  return updated ? serializeAlert(updated) : null;
}

export async function deleteUserAlert(
  user: MeUser,
  alertId: string
): Promise<boolean> {
  const removed = await db
    .delete(priceAlerts)
    .where(and(eq(priceAlerts.id, alertId), alertOwnerFilter(user)))
    .returning({ id: priceAlerts.id });
  return removed.length > 0;
}
