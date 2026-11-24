import { PANAMA_STORES } from "@regateo/shared";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  ClipboardList,
  Heart,
  LogOut,
  Sparkles,
  TrendingDown,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { useUserSpace } from "@/hooks/useUserSpace";
import { cn, formatUsd } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { AlertsTab } from "./account/AlertsTab";
import { FavoritesTab } from "./account/FavoritesTab";
import { ListsTab } from "./account/ListsTab";
import { ProductThumb } from "./account/ProductThumb";
import { BlurFade } from "./magicui/blur-fade";
import { NumberTicker } from "./magicui/number-ticker";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

type SpaceTab = "favoritos" | "listas" | "alertas";

export function AccountSpaceView() {
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const openProduct = useFilterStore((s) => s.openProduct);
  const toggleGuestFavorite = useFilterStore((s) => s.toggleGuestFavorite);

  const {
    user,
    isAuthenticated,
    isLoadingSession,
    overview,
    isLoadingOverview,
    isErrorOverview,
    overviewError,
    refetchOverview,
    favorites,
    lists,
    alerts,
    guestFavoriteIds,
    guestFavoriteItems,
    toggleFavorite,
    createList,
    isCreatingList,
    deleteList,
    addToList,
    removeFromList,
    updateAlert,
    deleteAlert,
    signOut,
  } = useUserSpace();

  const [activeTab, setActiveTab] = useState<SpaceTab>("favoritos");

  const droppedFavorites = useMemo(
    () => favorites.filter((f) => f.priceChangeSinceSavedCents < 0),
    [favorites]
  );

  // Loading session state
  if (isLoadingSession) {
    return (
      <section className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-8 h-64 w-full rounded-xl" />
      </section>
    );
  }

  // =========================================================================
  // GUEST EXPERIENCE: Persuasive value preview + local favorites ready to sync
  // =========================================================================
  if (!isAuthenticated || !user) {
    return (
      <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
        <BlurFade duration={0.32} yOffset={6}>
          <div className="overflow-hidden rounded-2xl border border-[#E7E5DF] bg-white card-elevation">
            <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <Badge variant="savingsSoft" className="mb-3">
                  <Sparkles className="h-3 w-3" />
                  Mi Espacio · 100% gratis
                </Badge>
                <h1 className="text-2xl leading-[1.15] font-extrabold tracking-[-0.03em] text-[#111315] text-balance sm:text-4xl">
                  Ahorra en automático con tu radar personal de precios en Panamá.
                </h1>
                <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-[#525866]">
                  Crea tu cuenta gratuita en segundos para rastrear bajadas de precio en
                  tus favoritos, armar presupuestos optimizados entre las {PANAMA_STORES.filter((s) => s.enabled).length} tiendas activas
                  y controlar todas tus alertas desde un solo lugar.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    variant="brand"
                    size="lg"
                    onClick={() => setAuthOpen(true, { mode: "signup" })}
                  >
                    Crear cuenta gratis
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => setAuthOpen(true, { mode: "signin" })}
                  >
                    Iniciar sesión
                  </Button>
                </div>
              </div>

              {/* Compact preview highlight card */}
              <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-5">
                <span className="text-[11px] font-bold tracking-[0.03em] text-[#047857] uppercase">
                  Ejemplo de ahorro en tu espacio
                </span>
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between rounded-lg border border-[#A7F3D0]/80 bg-white px-3 py-2.5 text-xs">
                    <div>
                      <p className="font-bold text-[#111315]">Lista “Mi Setup PC”</p>
                      <p className="text-[11px] text-[#525866]">
                        2 en Yoytec · 1 en Multimax · 1 en Panafoto
                      </p>
                    </div>
                    <span className="rounded-md bg-[#059669] px-2 py-1 font-mono text-[11px] font-bold text-white">
                      -$142.50
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[#A7F3D0]/80 bg-white px-3 py-2.5 text-xs">
                    <div>
                      <p className="font-bold text-[#111315]">Radar de favoritos</p>
                      <p className="text-[11px] text-[#525866]">
                        Guardado a $599.00 → Hoy $529.00
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#047857]">
                      Bajó -$70.00
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </BlurFade>

        {/* 3 Real Benefits Grid */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
              <TrendingDown className="h-5 w-5" />
            </span>
            <h2 className="mt-3.5 text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
              1. Radar personal de bajadas de precio
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
              Cada vez que guardas un favorito, registramos su precio exacto ese día y te
              avisamos cuánto ha bajado en Multimax, Panafoto, Rodelag, Titán, Photura,
              Do it Center, Yoytec o PTYTEC.
            </p>
          </div>

          <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
              <ClipboardList className="h-5 w-5" />
            </span>
            <h2 className="mt-3.5 text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
              2. Listas y presupuestos inteligentes
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
              Crea listas por proyecto (“Mi Setup PC”, “Línea Blanca Hogar”) y calculamos
              automáticamente dónde comprar cada artículo para pagar el mínimo total en
              Panamá.
            </p>
          </div>

          <div className="rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4F3EE] text-[#111315]">
              <Bell className="h-5 w-5" />
            </span>
            <h2 className="mt-3.5 text-[15px] font-bold tracking-[-0.015em] text-[#111315]">
              3. Gestión centralizada de alertas
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
              Visualiza qué tan cerca está cada producto de tu precio objetivo en USD,
              detecta al instante metas alcanzadas y edita o pausa alertas con un clic.
            </p>
          </div>
        </div>

        {/* Local Guest Favorites Ready to Sync */}
        {guestFavoriteIds.length > 0 ? (
          <div className="mt-8 rounded-2xl border border-[#E7E5DF] bg-white p-5 sm:p-6 card-elevation">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE5] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-[#E64825]" fill="currentColor" />
                  <h2 className="text-base font-bold text-[#111315]">
                    Tus favoritos guardados en este navegador ({guestFavoriteIds.length})
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-[#525866]">
                  Al iniciar sesión o crear tu cuenta gratuita, estos productos se
                  sincronizarán automáticamente en tu Radar Personal sin perder nada.
                </p>
              </div>
              <Button
                variant="brand"
                size="sm"
                onClick={() => setAuthOpen(true, { mode: "signup" })}
              >
                Sincronizar en mi cuenta
              </Button>
            </div>

            {guestFavoriteItems.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {guestFavoriteItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openProduct(item.slug)}
                        className="cursor-pointer"
                      >
                        <ProductThumb
                          imageUrl={item.imageUrl}
                          alt={item.canonicalName}
                          category={item.category}
                          size="sm"
                        />
                      </button>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => openProduct(item.slug)}
                          className="line-clamp-1 text-left text-xs font-bold text-[#111315] hover:text-[#E64825] cursor-pointer"
                        >
                          {item.canonicalName}
                        </button>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                          <span className="font-price font-bold text-[#047857]">
                            {formatUsd(item.bestPriceCents)}
                          </span>
                          {item.bestStoreName ? (
                            <span className="truncate text-[11px] text-[#666D7C]">
                              · {item.bestStoreName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleGuestFavorite(item.id)}
                      aria-label={`Quitar ${item.canonicalName} de guardados locales`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#666D7C] hover:bg-white hover:text-[#DC2626] cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-xs text-[#525866]">
                Tienes{" "}
                <strong className="font-mono text-[#111315]">
                  {guestFavoriteIds.length}
                </strong>{" "}
                {guestFavoriteIds.length === 1
                  ? "producto listo"
                  : "productos listos"}{" "}
                para migrarse al iniciar sesión.
              </p>
            )}
          </div>
        ) : null}
      </section>
    );
  }

  // =========================================================================
  // AUTHENTICATED EXPERIENCE: Mi Espacio Dashboard
  // =========================================================================
  const firstName =
    (user.name || user.email.split("@")[0] || "Usuario").split(" ")[0];
  const stats = overview?.stats ?? {
    favoritesCount: favorites.length,
    activeAlertsCount: alerts.filter((a) => a.active).length,
    reachedAlertsCount: alerts.filter((a) => a.active && a.reachedTarget).length,
    listsCount: lists.length,
    priceDropsSinceSavedCount: droppedFavorites.length,
    totalPotentialSavingsCents: 0,
  };
  const tabsLoading = isLoadingOverview && !overview;

  return (
    <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Personal Header */}
      <BlurFade duration={0.28} yOffset={6}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E7E5DF] pb-6">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#111315] text-lg font-extrabold text-white uppercase">
              {(user.name || user.email).slice(0, 1)}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#111315] sm:text-3xl">
                  Hola, {firstName}
                </h1>
                <Badge variant="best" className="text-[11px]">
                  Mi Espacio activo
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[#525866]">
                {user.email} · Sincronizado en las {PANAMA_STORES.filter((s) => s.enabled).length} tiendas activas de Panamá
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveView("catalogo")}
            >
              Explorar catálogo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              className="text-[#525866] hover:text-[#DC2626]"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Cerrar sesión</span>
            </Button>
          </div>
        </div>
      </BlurFade>

      {/* Error State */}
      {isErrorOverview && !overview ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-[#E64825]" />
          <h2 className="mt-3 text-base font-bold text-[#111315]">
            No pudimos cargar tu espacio personal
          </h2>
          <p className="mt-1 max-w-md text-sm text-[#525866]">
            {overviewError instanceof Error
              ? overviewError.message
              : "Intenta recargar en unos segundos."}
          </p>
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => void refetchOverview()}
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          {/* 4 KPI Cards with NumberTicker */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* KPI 1: Favoritos */}
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#525866]">
                  Favoritos guardados
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                  <Heart className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 font-price text-3xl font-bold text-[#111315]">
                {tabsLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <NumberTicker value={stats.favoritesCount} />
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#666D7C]">
                en tu radar personal de precios
              </p>
            </div>

            {/* KPI 2: Bajadas detectadas */}
            <div
              className={cn(
                "rounded-xl border p-4 card-elevation transition-colors",
                stats.priceDropsSinceSavedCount > 0
                  ? "border-[#A7F3D0] bg-[#ECFDF5]"
                  : "border-[#E7E5DF] bg-white"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    stats.priceDropsSinceSavedCount > 0
                      ? "text-[#047857]"
                      : "text-[#525866]"
                  )}
                >
                  Bajadas de precio detectadas
                </span>
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg",
                    stats.priceDropsSinceSavedCount > 0
                      ? "bg-[#059669] text-white"
                      : "bg-[#F4F3EE] text-[#525866]"
                  )}
                >
                  <TrendingDown className="h-4 w-4" />
                </span>
              </div>
              <div
                className={cn(
                  "mt-2 font-price text-3xl font-bold",
                  stats.priceDropsSinceSavedCount > 0
                    ? "text-[#059669]"
                    : "text-[#111315]"
                )}
              >
                {tabsLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <NumberTicker value={stats.priceDropsSinceSavedCount} />
                )}
              </div>
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  stats.priceDropsSinceSavedCount > 0
                    ? "font-medium text-[#065F46]"
                    : "text-[#666D7C]"
                )}
              >
                {stats.priceDropsSinceSavedCount > 0
                  ? "bajaron desde que los guardaste"
                  : "te avisaremos al detectar una baja"}
              </p>
            </div>

            {/* KPI 3: Alertas activas */}
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#525866]">
                  Alertas activas
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F4F3EE] text-[#111315]">
                  <Bell className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-price text-3xl font-bold text-[#111315]">
                  {tabsLoading ? (
                    <Skeleton className="h-9 w-16" />
                  ) : (
                    <NumberTicker value={stats.activeAlertsCount} />
                  )}
                </span>
                {stats.reachedAlertsCount > 0 ? (
                  <Badge className="bg-[#059669] text-white text-[11px]">
                    {stats.reachedAlertsCount}{" "}
                    {stats.reachedAlertsCount === 1 ? "alcanzada" : "alcanzadas"}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-[#666D7C]">
                {stats.reachedAlertsCount > 0
                  ? "¡Ya tienes metas alcanzadas hoy!"
                  : "monitoreando tu precio objetivo"}
              </p>
            </div>

            {/* KPI 4: Ahorro potencial detectado */}
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#525866]">
                  Ahorro potencial detectado
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
                  <Sparkles className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 font-price text-3xl font-bold text-[#047857]">
                {tabsLoading ? (
                  <Skeleton className="h-9 w-28" />
                ) : (
                  <>
                    $
                    <NumberTicker
                      value={stats.totalPotentialSavingsCents / 100}
                      decimalPlaces={2}
                    />
                  </>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#666D7C]">
                USD acumulados entre favoritos y listas
              </p>
            </div>
          </div>

          {/* 3 Main Tabs */}
          <div className="mt-8">
            <div
              role="tablist"
              aria-label="Secciones de Mi Espacio"
              className="inline-flex w-full flex-wrap gap-1 rounded-xl border border-[#E7E5DF] bg-white p-1.5 sm:w-auto"
            >
              {(
                [
                  {
                    id: "favoritos" as const,
                    label: "Favoritos",
                    icon: Heart,
                    count: favorites.length,
                    highlight: stats.priceDropsSinceSavedCount > 0,
                  },
                  {
                    id: "listas" as const,
                    label: "Listas y Presupuestos",
                    icon: ClipboardList,
                    count: lists.length,
                    highlight: false,
                  },
                  {
                    id: "alertas" as const,
                    label: "Alertas de Precio",
                    icon: Bell,
                    count: alerts.length,
                    highlight: stats.reachedAlertsCount > 0,
                  },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors sm:flex-none sm:text-[13px] cursor-pointer",
                      active
                        ? "text-[#111315]"
                        : "text-[#525866] hover:text-[#111315]"
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="account-space-tab-pill"
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 rounded-lg border border-[#E7E5DF] bg-[#F4F3EE]"
                      />
                    ) : null}
                    <Icon
                      className={cn(
                        "relative z-10 h-3.5 w-3.5",
                        active && tab.id === "favoritos" ? "text-[#E64825]" : ""
                      )}
                    />
                    <span className="relative z-10">{tab.label}</span>
                    <span
                      className={cn(
                        "relative z-10 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                        tab.highlight
                          ? "bg-[#059669] text-white"
                          : active
                          ? "bg-white text-[#111315]"
                          : "bg-[#F4F3EE] text-[#525866]"
                      )}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeTab === "favoritos" ? (
              <FavoritesTab
                favorites={favorites}
                lists={lists}
                isLoading={tabsLoading}
                onOpenProduct={openProduct}
                onRemoveFavorite={(productId, product) => {
                  toggleFavorite(productId, product);
                }}
                onAddToList={(listId, productId) =>
                  addToList(listId, productId, 1)
                }
                onGoToCatalog={() => setActiveView("catalogo")}
                onGoToDeals={() => setActiveView("ofertas")}
                onGoToListsTab={() => setActiveTab("listas")}
              />
            ) : null}

            {activeTab === "listas" ? (
              <ListsTab
                lists={lists}
                isLoading={tabsLoading}
                isCreatingList={isCreatingList}
                onCreateList={createList}
                onDeleteList={deleteList}
                onRemoveItem={removeFromList}
                onOpenProduct={openProduct}
                onExploreCatalog={() => setActiveView("catalogo")}
              />
            ) : null}

            {activeTab === "alertas" ? (
              <AlertsTab
                alerts={alerts}
                isLoading={tabsLoading}
                onOpenProduct={openProduct}
                onUpdateAlert={updateAlert}
                onDeleteAlert={deleteAlert}
                onGoToCatalog={() => setActiveView("catalogo")}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
