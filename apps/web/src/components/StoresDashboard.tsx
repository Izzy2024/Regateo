import { PANAMA_STORES, type StoreStatusDTO } from "@regateo/shared";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";
import { fetchStores } from "@/lib/api";
import {
  formatDateTimeEs,
  formatRelativeEs,
  getDomainLabel,
  sanitizeExternalUrl,
} from "@/lib/utils";
import { BlurFade } from "./magicui/blur-fade";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const PLATFORM_LABELS: Record<string, string> = {
  shopify: "Shopify JSON",
  magento: "Magento / Firecrawl",
  "firecrawl-html": "Firecrawl HTML",
  custom: "Adaptador propio",
};

interface DisplayStore extends StoreStatusDTO {
  description?: string;
}

export function StoresDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["stores"],
    queryFn: fetchStores,
    staleTime: 30_000,
  });

  const apiStores = data?.stores ?? [];
  const recentRuns = data?.recentRuns ?? [];

  const displayStores: DisplayStore[] = useMemo(() => {
    const apiBySlug = new Map(apiStores.map((store) => [store.slug, store]));
    const configBySlug = new Map(
      PANAMA_STORES.map((store) => [store.slug, store])
    );

    const ordered: DisplayStore[] = PANAMA_STORES.map((config) => {
      const live = apiBySlug.get(config.slug);
      if (live) {
        return {
          ...live,
          description: config.description,
        };
      }
      return {
        id: config.slug,
        slug: config.slug,
        name: config.name,
        baseUrl: config.baseUrl,
        platform: config.platform,
        color: config.color,
        accentBg: config.accentBg,
        enabled: config.enabled,
        listingCount: 0,
        lastScrapedAt: null,
        lastRunStatus: null,
        lastRunItems: 0,
        description: config.description,
      };
    });

    for (const live of apiStores) {
      if (!configBySlug.has(live.slug)) {
        ordered.push(live);
      }
    }

    return ordered;
  }, [apiStores]);

  const activeIndexedStoresCount = displayStores.length;
  const totalListings = displayStores.reduce((sum, s) => sum + s.listingCount, 0);

  return (
    <section className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Header & Automation Banner */}
      <BlurFade duration={0.32} yOffset={6}>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E7E5DF] pb-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#111315] text-balance sm:text-3xl">
              Tiendas monitoreadas y radar de precios
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#525866]">
              Rastreamos automáticamente precios reales en USD de los principales comercios
              de tecnología, cómputo y línea blanca en Panamá con un{" "}
              <strong>barrido diario (08:00 UTC)</strong>, con verificación de enlaces
              directos y registro histórico.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 py-2 text-xs font-semibold text-[#047857]">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Sincronización interna automática · Barrido diario</span>
          </div>
        </div>
      </BlurFade>

      {/* Automation cadence strip */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#E7E5DF] bg-white px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
            <CalendarClock className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-bold text-[#111315]">
              Frecuencia automatizada: barrido diario (08:00 UTC)
            </p>
            <p className="mt-0.5 text-xs text-[#525866]">
              Motor híbrido: adaptadores Shopify JSON para Multimax, Rodelag, Almacenes
              Titán y Photura + Magento/Firecrawl para Panafoto, Do it Center, Yoytec y
              PTYTEC.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <div>
            <span className="block text-[#666D7C]">Tiendas activas</span>
            <span className="font-price text-base font-bold text-[#111315]">
              {activeIndexedStoresCount}
            </span>
          </div>
          <div className="h-8 w-px bg-[#E7E5DF]" />
          <div>
            <span className="block text-[#666D7C]">Listados indexados</span>
            <span className="font-price text-base font-bold text-[#111315]">
              {totalListings.toLocaleString("en-US")}
            </span>
          </div>
        </div>
      </div>

      {/* Stores directory */}
      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-[#E7E5DF] bg-white p-5 space-y-3"
              >
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center rounded-2xl border border-[#E7E5DF] bg-white px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-[#E64825]" />
            <h2 className="mt-3 text-base font-bold text-[#111315]">
              No se pudo consultar el estado de las tiendas
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#525866]">
              {error instanceof Error
                ? error.message
                : "Verifica que la API esté corriendo en el puerto configurado."}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayStores.map((store) => {
              const safeUrl = sanitizeExternalUrl(store.baseUrl);
              const isHealthy =
                store.lastRunStatus === "completed" || store.listingCount > 0;
              const isFailed = store.lastRunStatus === "failed";

              return (
                <article
                  key={store.id}
                  className="flex flex-col justify-between rounded-xl border border-[#E7E5DF] bg-white p-5 card-elevation"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold"
                          style={{
                            backgroundColor: store.accentBg,
                            color: store.color,
                          }}
                        >
                          {store.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h2 className="truncate text-[15px] font-bold text-[#111315]">
                            {store.name}
                          </h2>
                          <p className="truncate text-xs text-[#666D7C]">
                            {getDomainLabel(store.baseUrl)}
                          </p>
                        </div>
                      </div>

                      {isFailed ? (
                        <Badge variant="savingsSoft">Con error</Badge>
                      ) : isHealthy ? (
                        <Badge variant="best">Activo</Badge>
                      ) : (
                        <Badge variant="muted">Pendiente</Badge>
                      )}
                    </div>

                    {store.description ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-[#525866]">
                        {store.description}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-[#EFECE5] bg-[#FAFAF7] p-3 text-xs">
                      <div>
                        <span className="block text-[#666D7C]">Productos indexados</span>
                        <span className="mt-0.5 block font-price text-base font-bold text-[#111315]">
                          {store.listingCount.toLocaleString("en-US")}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[#666D7C]">Último barrido</span>
                        <span className="mt-0.5 block font-semibold text-[#111315]">
                          {formatRelativeEs(store.lastScrapedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[#EFECE5] pt-3 text-xs">
                    <span className="rounded bg-[#F4F3EE] px-2 py-0.5 font-mono text-[11px] text-[#525866]">
                      {PLATFORM_LABELS[store.platform] ?? store.platform}
                    </span>
                    {safeUrl ? (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#111315] hover:text-[#E64825]"
                      >
                        Visitar tienda
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent scrape runs table */}
      {recentRuns.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-bold tracking-[-0.015em] text-[#111315]">
            Registro reciente de barridos automáticos
          </h2>
          <div className="overflow-x-auto rounded-xl border border-[#E7E5DF] bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#E7E5DF] bg-[#FAFAF7] text-[11px] font-bold tracking-[0.02em] text-[#525866] uppercase">
                  <th className="px-4 py-2.5">Tienda</th>
                  <th className="px-4 py-2.5">Motor</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Encontrados</th>
                  <th className="px-4 py-2.5">Actualizados</th>
                  <th className="px-4 py-2.5 text-right">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE5]">
                {recentRuns.slice(0, 12).map((run) => (
                  <tr key={run.id} className="hover:bg-[#FAFAF7]">
                    <td className="px-4 py-2.5 font-semibold text-[#111315]">
                      {run.storeName || run.storeSlug || "Tienda"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[#525866]">
                      {run.engine}
                    </td>
                    <td className="px-4 py-2.5">
                      {run.status === "completed" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#047857]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Completado
                        </span>
                      ) : run.status === "failed" ? (
                        <span
                          className="inline-flex items-center gap-1 font-semibold text-[#DC2626]"
                          title={run.errorMessage ?? undefined}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Error
                        </span>
                      ) : (
                        <span className="font-medium text-[#525866]">{run.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-price text-[#111315]">
                      {run.itemsFound}
                    </td>
                    <td className="px-4 py-2.5 font-price font-semibold text-[#047857]">
                      {run.itemsUpserted}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#525866]">
                      {formatDateTimeEs(run.finishedAt || run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
