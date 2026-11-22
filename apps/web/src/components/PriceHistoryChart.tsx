import type { PriceHistoryPointDTO } from "@regateo/shared";
import { TrendingDown } from "lucide-react";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatShortDateEs, formatUsd } from "@/lib/utils";

interface PriceHistoryChartProps {
  history: PriceHistoryPointDTO[];
}

interface StoreSeries {
  slug: string;
  name: string;
  color: string;
}

export function PriceHistoryChart({ history }: PriceHistoryChartProps) {
  const { chartData, stores } = useMemo(() => {
    const storeMap = new Map<string, StoreSeries>();
    const byDate = new Map<string, Record<string, string | number>>();

    const sorted = [...history].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const point of sorted) {
      if (!storeMap.has(point.storeSlug)) {
        storeMap.set(point.storeSlug, {
          slug: point.storeSlug,
          name: point.storeName,
          color: point.storeColor || "#E64825",
        });
      }

      const dayKey = point.date.slice(0, 10);
      const existing = byDate.get(dayKey) ?? {
        date: dayKey,
        label: formatShortDateEs(point.date),
      };
      existing[point.storeSlug] = Number((point.priceCents / 100).toFixed(2));
      byDate.set(dayKey, existing);
    }

    return {
      chartData: Array.from(byDate.values()),
      stores: Array.from(storeMap.values()),
    };
  }, [history]);

  if (chartData.length === 0 || stores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D5D2C9] bg-[#FAFAF7] px-4 py-8 text-center">
        <TrendingDown className="h-5 w-5 text-[#666D7C]" />
        <p className="mt-2 text-sm font-semibold text-[#111315]">
          Historial en construcción
        </p>
        <p className="mt-1 max-w-sm text-xs text-[#525866]">
          Cada barrido automático diario registra un nuevo punto de precio para
          detectar subidas y bajas reales.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[#111315]">
            Evolución de precios por tienda (USD)
          </h4>
          <p className="text-xs text-[#525866]">
            {chartData.length === 1
              ? "Primer punto capturado. Nuevos registros aparecerán en el próximo barrido."
              : `${chartData.length} fechas monitoreadas en ${stores.length} ${
                  stores.length === 1 ? "tienda" : "tiendas"
                }.`}
          </p>
        </div>
      </div>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5DF" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#525866", fontSize: 11 }}
              axisLine={{ stroke: "#E7E5DF" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#525866", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              width={66}
              tickFormatter={(value: number) => `$${value.toLocaleString("en-US")}`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#FFFFFF",
                borderColor: "#E7E5DF",
                borderRadius: "10px",
                boxShadow: "0 8px 20px rgba(17,19,21,0.08)",
                fontSize: "12px",
              }}
              labelStyle={{ fontWeight: 700, color: "#111315", marginBottom: 4 }}
              formatter={(value: unknown, name: string) => {
                const numeric = typeof value === "number" ? value : Number(value);
                return [
                  Number.isFinite(numeric) ? formatUsd(Math.round(numeric * 100)) : "-",
                  name,
                ];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
              iconType="circle"
              iconSize={8}
            />
            {stores.map((s) => (
              <Line
                key={s.slug}
                type="monotone"
                dataKey={s.slug}
                name={s.name}
                stroke={s.color}
                strokeWidth={2.25}
                dot={{ r: 3.5, strokeWidth: 1.5, fill: "#FFFFFF" }}
                activeDot={{ r: 5.5, strokeWidth: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
