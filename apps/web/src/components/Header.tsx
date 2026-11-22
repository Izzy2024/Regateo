import {
  BookOpen,
  Flame,
  Heart,
  LogOut,
  Radar,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { motion } from "motion/react";
import { useUserSpace } from "@/hooks/useUserSpace";
import { cn } from "@/lib/utils";
import { type AppView, useFilterStore } from "@/store/useFilterStore";
import { ShimmerButton } from "./magicui/shimmer-button";
import { Button } from "./ui/button";

const NAV_ITEMS: Array<{
  id: AppView;
  label: string;
  shortLabel: string;
  icon: typeof Search;
}> = [
  { id: "catalogo", label: "Explorar", shortLabel: "Explorar", icon: Search },
  { id: "ofertas", label: "Mejores Ofertas", shortLabel: "Ofertas", icon: Flame },
  { id: "guias", label: "Guías", shortLabel: "Guías", icon: BookOpen },
  { id: "tiendas", label: "Tiendas y Radar", shortLabel: "Tiendas", icon: Radar },
  { id: "mi-espacio", label: "Mi Espacio", shortLabel: "Mi Espacio", icon: Heart },
];

export function Header() {
  const activeView = useFilterStore((s) => s.activeView);
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);

  const { user, isAuthenticated, overview, guestFavoriteIds, signOut } =
    useUserSpace();

  const favoritesCount = isAuthenticated
    ? (overview?.stats.favoritesCount ?? 0)
    : guestFavoriteIds.length;
  const priceDropsCount = isAuthenticated
    ? (overview?.stats.priceDropsSinceSavedCount ?? 0)
    : 0;
  const reachedAlertsCount = isAuthenticated
    ? (overview?.stats.reachedAlertsCount ?? 0)
    : 0;
  const hasGoodNews = priceDropsCount > 0 || reachedAlertsCount > 0;

  return (
    <header className="sticky top-0 z-40 border-b border-[#E7E5DF] bg-[#FAFAF7]/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setActiveView("catalogo")}
          className="group flex items-center gap-2.5 text-left cursor-pointer"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E7E5DF] bg-white p-1 shadow-[0_1px_2px_rgba(17,19,21,0.04)] transition-transform duration-200 group-hover:scale-105 group-hover:border-[#FBCFC3]">
            <img
              src="/logo-mark.webp"
              alt="Logo de Regateo"
              width={192}
              height={192}
              className="h-full w-full object-contain"
            />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[18px] font-extrabold tracking-[-0.035em] text-[#111315]">
              Regateo
            </span>
            <span className="mt-0.5 hidden text-[11px] font-medium text-[#666D7C] sm:block">
              Precios en Panamá · USD
            </span>
          </span>
        </button>

        <nav
          aria-label="Navegación principal"
          className="hidden items-center gap-1 rounded-xl border border-[#E7E5DF] bg-white p-1 md:flex"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const isSpace = item.id === "mi-espacio";
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer",
                  isActive ? "text-[#111315]" : "text-[#525866] hover:text-[#111315]"
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="header-nav-pill"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0 rounded-lg border border-[#E7E5DF] bg-[#F4F3EE]"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "relative z-10 h-3.5 w-3.5",
                    isActive && (item.id === "ofertas" || isSpace)
                      ? "text-[#E64825]"
                      : ""
                  )}
                  fill={isSpace && isActive ? "currentColor" : "none"}
                  strokeWidth={2}
                />
                <span className="relative z-10">{item.label}</span>
                {isSpace && (hasGoodNews || favoritesCount > 0) ? (
                  <span
                    className={cn(
                      "relative z-10 inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none font-bold tabular-nums",
                      hasGoodNews
                        ? "bg-[#059669] text-white"
                        : "bg-[#EFECE5] text-[#111315]"
                    )}
                    title={
                      priceDropsCount > 0
                        ? `${priceDropsCount} bajadas de precio detectadas`
                        : `${favoritesCount} favoritos guardados`
                    }
                  >
                    {priceDropsCount > 0
                      ? `↓${priceDropsCount}`
                      : favoritesCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ShimmerButton onClick={() => setAiOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Regateo AI</span>
          </ShimmerButton>

          {user ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveView("mi-espacio")}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-semibold transition-colors cursor-pointer",
                  activeView === "mi-espacio"
                    ? "border-[#111315] bg-[#111315] text-white"
                    : "border-[#E7E5DF] bg-white text-[#111315] hover:bg-[#F4F3EE]"
                )}
                title={`Ir a Mi Espacio (${user.email})`}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold uppercase",
                    activeView === "mi-espacio"
                      ? "bg-[#E64825] text-white"
                      : "bg-[#111315] text-white"
                  )}
                >
                  {(user.name || user.email).slice(0, 1)}
                </span>
                <span className="hidden max-w-[110px] truncate sm:inline">
                  {user.name || user.email.split("@")[0]}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void signOut()}
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
                className="h-8 w-8"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAuthOpen(true, { mode: "signin" })}
              className="gap-1.5"
            >
              <User className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">Mi Cuenta</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex border-t border-[#E7E5DF] bg-white px-2 py-1.5 md:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const isSpace = item.id === "mi-espacio";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors cursor-pointer",
                isActive
                  ? "bg-[#F4F3EE] text-[#111315]"
                  : "text-[#525866] hover:text-[#111315]"
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive && (item.id === "ofertas" || isSpace)
                    ? "text-[#E64825]"
                    : ""
                )}
              />
              <span className="truncate">{item.shortLabel}</span>
              {isSpace && (hasGoodNews || favoritesCount > 0) ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1 py-0.5 font-mono text-[9px] leading-none font-bold",
                    hasGoodNews
                      ? "bg-[#059669] text-white"
                      : "bg-[#E7E5DF] text-[#111315]"
                  )}
                >
                  {priceDropsCount > 0 ? `↓${priceDropsCount}` : favoritesCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </header>
  );
}
