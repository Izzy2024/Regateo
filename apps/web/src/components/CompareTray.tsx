import { ArrowUpRight, Scale, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { formatUsd, getCategoryShortLabel, sanitizeExternalUrl } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function CompareTray() {
  const compareItems = useFilterStore((s) => s.compareItems);
  const removeCompareItem = useFilterStore((s) => s.removeCompareItem);
  const clearCompare = useFilterStore((s) => s.clearCompare);
  const compareModalOpen = useFilterStore((s) => s.compareModalOpen);
  const setCompareModalOpen = useFilterStore((s) => s.setCompareModalOpen);
  const openProduct = useFilterStore((s) => s.openProduct);

  const lowestPriceCents =
    compareItems.length > 0
      ? Math.min(...compareItems.map((i) => i.bestPriceCents))
      : 0;

  return (
    <>
      <AnimatePresence>
        {compareItems.length > 0 ? (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 rounded-2xl border border-[#111315]/15 bg-[#111315] p-3 text-white modal-elevation"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold">
                  <Scale className="h-3.5 w-3.5 text-[#E64825]" />
                  <span>{compareItems.length}/3</span>
                </span>

                {compareItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex max-w-[180px] shrink-0 items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{item.canonicalName}</div>
                      <div className="font-price text-[11px] text-[#6EE7B7]">
                        {formatUsd(item.bestPriceCents)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCompareItem(item.id)}
                      aria-label={`Quitar ${item.canonicalName}`}
                      className="rounded p-0.5 text-white/70 hover:bg-white/15 hover:text-white cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={clearCompare}
                  aria-label="Vaciar comparador"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <Button
                  variant="brand"
                  size="sm"
                  onClick={() => setCompareModalOpen(true)}
                  disabled={compareItems.length < 2}
                >
                  {compareItems.length < 2
                    ? "Agrega 1 más"
                    : `Comparar (${compareItems.length})`}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Dialog
        open={compareModalOpen && compareItems.length > 0}
        onClose={() => setCompareModalOpen(false)}
        maxWidthClass="max-w-5xl"
        title="Comparación lado a lado"
        description="Contrasta precio más bajo, tiendas disponibles y ahorro directo en USD."
      >
        <div className="overflow-x-auto p-5 sm:p-6">
          <table className="w-full min-w-[600px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#E7E5DF]">
                <th className="w-40 py-3 pr-4 align-top text-xs font-bold text-[#666D7C] uppercase">
                  Producto
                </th>
                {compareItems.map((item) => (
                  <th key={item.id} className="min-w-[190px] px-3 py-3 align-top">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCompareModalOpen(false);
                          openProduct(item.slug);
                        }}
                        className="line-clamp-2 text-left text-sm font-bold text-[#111315] hover:text-[#E64825] cursor-pointer"
                      >
                        {item.canonicalName}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCompareItem(item.id)}
                        aria-label="Quitar producto"
                        className="shrink-0 rounded p-1 text-[#666D7C] hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFECE5]">
              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-[#525866]">
                  Mejor precio
                </td>
                {compareItems.map((item) => {
                  const isLowest = item.bestPriceCents === lowestPriceCents;
                  return (
                    <td key={item.id} className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-price text-lg font-bold text-[#047857]">
                          {formatUsd(item.bestPriceCents)}
                        </span>
                        {isLowest ? <Badge variant="best">Más económico</Badge> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-[#525866]">
                  Tienda ganadora
                </td>
                {compareItems.map((item) => (
                  <td key={item.id} className="px-3 py-3">
                    {item.bestStore ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#111315]">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: item.bestStore.color }}
                        />
                        {item.bestStore.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-[#525866]">
                  Ahorro detectado
                </td>
                {compareItems.map((item) => (
                  <td key={item.id} className="px-3 py-3">
                    {item.savingsCents >= 100 ? (
                      <span className="font-price font-semibold text-[#B83416]">
                        {formatUsd(item.savingsCents)} (-{item.savingsPercent}%)
                      </span>
                    ) : (
                      <span className="text-xs text-[#666D7C]">Precio único</span>
                    )}
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-[#525866]">
                  Tiendas disponibles
                </td>
                {compareItems.map((item) => (
                  <td key={item.id} className="px-3 py-3 tabular-nums text-[#111315]">
                    {item.storeCount} {item.storeCount === 1 ? "tienda" : "tiendas"} (
                    {item.inStockCount} en stock)
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-[#525866]">
                  Marca / Modelo
                </td>
                {compareItems.map((item) => (
                  <td key={item.id} className="px-3 py-3 text-xs text-[#525866]">
                    <div className="font-semibold text-[#111315]">
                      {item.brand || getCategoryShortLabel(item.category)}
                    </div>
                    {item.modelNumber ? (
                      <div className="font-mono text-[11px]">{item.modelNumber}</div>
                    ) : null}
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-[#525866]">
                  Acción directa
                </td>
                {compareItems.map((item) => {
                  const safeUrl = sanitizeExternalUrl(item.bestStore?.url);
                  return (
                    <td key={item.id} className="px-3 py-3">
                      <div className="flex flex-col gap-1.5">
                        {safeUrl && item.bestStore ? (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-[#111315] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#E64825]"
                          >
                            <span>Ir a {item.bestStore.name}</span>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            setCompareModalOpen(false);
                            openProduct(item.slug);
                          }}
                        >
                          Ver historial y tiendas
                        </Button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  );
}
