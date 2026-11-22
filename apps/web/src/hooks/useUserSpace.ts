import type {
  CreateShoppingListInput,
  FavoriteProductDTO,
  ProductSummaryDTO,
  ShoppingListDTO,
  UpdateAlertInput,
  UserAlertDTO,
  UserOverviewDTO,
} from "@regateo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
  addFavoriteApi,
  addListItemApi,
  createShoppingListApi,
  deleteShoppingListApi,
  deleteUserAlertApi,
  fetchUserOverview,
  getAuthSession,
  removeFavoriteApi,
  removeListItemApi,
  signOutAuth,
  syncFavoritesApi,
  updateUserAlertApi,
} from "@/lib/api";
import { useFilterStore } from "@/store/useFilterStore";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Module-level deduplication so multiple mounted consumers (e.g. 24 ProductCards)
// never fire duplicate /api/me/favorites/sync requests on login.
const syncedMigrationKeys = new Set<string>();

export const USER_OVERVIEW_QUERY_KEY = ["user-overview"] as const;
export const AUTH_SESSION_QUERY_KEY = ["auth-session"] as const;

export function useUserSpace() {
  const queryClient = useQueryClient();
  const guestFavoriteIds = useFilterStore((s) => s.favorites);
  const guestFavoriteItems = useFilterStore((s) => s.guestFavoriteItems);
  const guestFavoriteSlugs = useFilterStore((s) => s.favoriteSlugs);
  const toggleGuestFavorite = useFilterStore((s) => s.toggleGuestFavorite);
  const clearGuestFavorites = useFilterStore((s) => s.clearGuestFavorites);

  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: getAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  const user = sessionQuery.data?.user ?? null;
  const isAuthenticated = Boolean(user);

  const overviewQuery = useQuery({
    queryKey: USER_OVERVIEW_QUERY_KEY,
    queryFn: fetchUserOverview,
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: false,
  });

  // Automatic guest favorites migration right after login
  useEffect(() => {
    if (!user || guestFavoriteIds.length === 0) return;

    const validIds = guestFavoriteIds.filter((id) => UUID_REGEX.test(id));
    if (validIds.length === 0) {
      clearGuestFavorites();
      return;
    }

    const migrationKey = `${user.id}:${[...validIds].sort().join(",")}`;
    if (syncedMigrationKeys.has(migrationKey)) return;
    syncedMigrationKeys.add(migrationKey);

    let cancelled = false;
    void (async () => {
      try {
        await syncFavoritesApi(validIds);
        if (!cancelled) {
          clearGuestFavorites();
          await queryClient.invalidateQueries({
            queryKey: USER_OVERVIEW_QUERY_KEY,
          });
        }
      } catch {
        // Allow retry on next mount/session check if sync failed transiently
        syncedMigrationKeys.delete(migrationKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, guestFavoriteIds, clearGuestFavorites, queryClient]);

  const overview: UserOverviewDTO | undefined = isAuthenticated
    ? overviewQuery.data
    : undefined;

  const favorites: FavoriteProductDTO[] = overview?.favorites ?? [];
  const lists: ShoppingListDTO[] = overview?.lists ?? [];
  const alerts: UserAlertDTO[] = overview?.alerts ?? [];

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (vars: {
      productId: string;
      currentlyFavorited: boolean;
      product?: ProductSummaryDTO;
    }) => {
      if (vars.currentlyFavorited) {
        await removeFavoriteApi(vars.productId);
      } else {
        await addFavoriteApi(vars.productId);
      }
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      const previous = queryClient.getQueryData<UserOverviewDTO>(
        USER_OVERVIEW_QUERY_KEY
      );

      if (previous) {
        if (vars.currentlyFavorited) {
          const nextFavs = previous.favorites.filter(
            (fav) => fav.productId !== vars.productId
          );
          const nextDrops = nextFavs.filter(
            (fav) => fav.priceChangeSinceSavedCents < 0
          ).length;
          queryClient.setQueryData<UserOverviewDTO>(USER_OVERVIEW_QUERY_KEY, {
            ...previous,
            stats: {
              ...previous.stats,
              favoritesCount: nextFavs.length,
              priceDropsSinceSavedCount: nextDrops,
            },
            favorites: nextFavs,
          });
        } else if (vars.product) {
          const optimisticFav: FavoriteProductDTO = {
            id: `optimistic-${vars.productId}`,
            productId: vars.productId,
            savedPriceCents: vars.product.bestPriceCents,
            currentBestPriceCents: vars.product.bestPriceCents,
            priceChangeSinceSavedCents: 0,
            note: null,
            createdAt: new Date().toISOString(),
            product: vars.product,
          };
          const nextFavs = [
            optimisticFav,
            ...previous.favorites.filter((f) => f.productId !== vars.productId),
          ];
          queryClient.setQueryData<UserOverviewDTO>(USER_OVERVIEW_QUERY_KEY, {
            ...previous,
            stats: {
              ...previous.stats,
              favoritesCount: nextFavs.length,
            },
            favorites: nextFavs,
          });
        }
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(USER_OVERVIEW_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const createListMutation = useMutation({
    mutationFn: (input: CreateShoppingListInput) => createShoppingListApi(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: (listId: string) => deleteShoppingListApi(listId),
    onMutate: async (listId) => {
      await queryClient.cancelQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      const previous = queryClient.getQueryData<UserOverviewDTO>(
        USER_OVERVIEW_QUERY_KEY
      );
      if (previous) {
        const nextLists = previous.lists.filter((l) => l.id !== listId);
        queryClient.setQueryData<UserOverviewDTO>(USER_OVERVIEW_QUERY_KEY, {
          ...previous,
          stats: {
            ...previous.stats,
            listsCount: nextLists.length,
          },
          lists: nextLists,
        });
      }
      return { previous };
    },
    onError: (_err, _listId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(USER_OVERVIEW_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const addToListMutation = useMutation({
    mutationFn: ({
      listId,
      productId,
      quantity = 1,
    }: {
      listId: string;
      productId: string;
      quantity?: number;
    }) => addListItemApi(listId, productId, quantity),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const removeFromListMutation = useMutation({
    mutationFn: ({
      listId,
      productId,
    }: {
      listId: string;
      productId: string;
    }) => removeListItemApi(listId, productId),
    onMutate: async ({ listId, productId }) => {
      await queryClient.cancelQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      const previous = queryClient.getQueryData<UserOverviewDTO>(
        USER_OVERVIEW_QUERY_KEY
      );
      if (previous) {
        const nextLists = previous.lists.map((list) => {
          if (list.id !== listId) return list;
          const nextItems = list.items.filter((i) => i.productId !== productId);
          const totalBestPriceCents = nextItems.reduce(
            (sum, i) => sum + i.product.bestPriceCents * i.quantity,
            0
          );
          const totalHighestPriceCents = nextItems.reduce(
            (sum, i) =>
              sum +
              Math.max(i.product.highestPriceCents, i.product.bestPriceCents) *
                i.quantity,
            0
          );
          return {
            ...list,
            items: nextItems,
            itemCount: nextItems.reduce((sum, i) => sum + i.quantity, 0),
            totalBestPriceCents,
            totalHighestPriceCents,
            totalSavingsCents: Math.max(
              0,
              totalHighestPriceCents - totalBestPriceCents
            ),
          };
        });
        queryClient.setQueryData<UserOverviewDTO>(USER_OVERVIEW_QUERY_KEY, {
          ...previous,
          lists: nextLists,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(USER_OVERVIEW_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const updateAlertMutation = useMutation({
    mutationFn: ({
      alertId,
      input,
    }: {
      alertId: string;
      input: UpdateAlertInput;
    }) => updateUserAlertApi(alertId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (alertId: string) => deleteUserAlertApi(alertId),
    onMutate: async (alertId) => {
      await queryClient.cancelQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      const previous = queryClient.getQueryData<UserOverviewDTO>(
        USER_OVERVIEW_QUERY_KEY
      );
      if (previous) {
        const nextAlerts = previous.alerts.filter((a) => a.id !== alertId);
        queryClient.setQueryData<UserOverviewDTO>(USER_OVERVIEW_QUERY_KEY, {
          ...previous,
          stats: {
            ...previous.stats,
            activeAlertsCount: nextAlerts.filter((a) => a.active).length,
            reachedAlertsCount: nextAlerts.filter(
              (a) => a.active && a.reachedTarget
            ).length,
          },
          alerts: nextAlerts,
        });
      }
      return { previous };
    },
    onError: (_err, _alertId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(USER_OVERVIEW_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
  });

  const isFavorited = useCallback(
    (productId: string, slug?: string): boolean => {
      if (isAuthenticated) {
        return favorites.some((fav) => fav.productId === productId);
      }
      if (guestFavoriteIds.includes(productId)) return true;
      if (slug && guestFavoriteSlugs.includes(slug)) return true;
      return false;
    },
    [isAuthenticated, favorites, guestFavoriteIds, guestFavoriteSlugs]
  );

  const toggleFavorite = useCallback(
    (productId: string, product?: ProductSummaryDTO) => {
      if (isAuthenticated) {
        const currentlyFavorited = favorites.some(
          (fav) => fav.productId === productId
        );
        toggleFavoriteMutation.mutate({
          productId,
          currentlyFavorited,
          product,
        });
        return { isAuthenticated: true, added: !currentlyFavorited };
      }

      const added = toggleGuestFavorite(productId, product);
      return { isAuthenticated: false, added };
    },
    [isAuthenticated, favorites, toggleFavoriteMutation, toggleGuestFavorite]
  );

  const addToList = useCallback(
    async (listId: string, productId: string, quantity = 1) => {
      return addToListMutation.mutateAsync({ listId, productId, quantity });
    },
    [addToListMutation]
  );

  const removeFromList = useCallback(
    async (listId: string, productId: string) => {
      return removeFromListMutation.mutateAsync({ listId, productId });
    },
    [removeFromListMutation]
  );

  const createList = useCallback(
    async (input: CreateShoppingListInput) => {
      return createListMutation.mutateAsync(input);
    },
    [createListMutation]
  );

  const deleteList = useCallback(
    async (listId: string) => {
      return deleteListMutation.mutateAsync(listId);
    },
    [deleteListMutation]
  );

  const updateAlert = useCallback(
    async (alertId: string, input: UpdateAlertInput) => {
      return updateAlertMutation.mutateAsync({ alertId, input });
    },
    [updateAlertMutation]
  );

  const deleteAlert = useCallback(
    async (alertId: string) => {
      return deleteAlertMutation.mutateAsync(alertId);
    },
    [deleteAlertMutation]
  );

  const signOut = useCallback(async () => {
    await signOutAuth();
    syncedMigrationKeys.clear();
    queryClient.removeQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
  }, [queryClient]);

  return {
    user,
    isAuthenticated,
    isLoadingSession: sessionQuery.isLoading,
    overview,
    isLoadingOverview: overviewQuery.isLoading,
    isErrorOverview: overviewQuery.isError,
    overviewError: overviewQuery.error,
    refetchOverview: overviewQuery.refetch,
    favorites,
    lists,
    alerts,
    guestFavoriteIds,
    guestFavoriteItems,
    isFavorited,
    toggleFavorite,
    isTogglingFavorite: toggleFavoriteMutation.isPending,
    addToList,
    isAddingToList: addToListMutation.isPending,
    removeFromList,
    createList,
    isCreatingList: createListMutation.isPending,
    deleteList,
    updateAlert,
    isUpdatingAlert: updateAlertMutation.isPending,
    deleteAlert,
    signOut,
  };
}
