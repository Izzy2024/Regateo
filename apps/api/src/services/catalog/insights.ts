// ============================================================================
// "Verdad del precio" por producto (Fase 3): estadísticas históricas reales,
// detector honesto de descuentos falsos y veredicto "¿Compro ahora o espero?".
// ============================================================================
import type {
  PriceHistoryPointDTO,
  PriceInsightDTO,
  StoreListingDTO,
} from "@regateo/shared";
import { roundSavingsPercent } from "./shared";

export interface PriceInsightInput {
  bestPriceCents: number;
  highestPriceCents: number;
  savingsCents: number;
}

/** Estadísticas históricas desde las observaciones reales (por día/tienda). */
function historicalStats(priceHistory: PriceHistoryPointDTO[]): {
  daysTracked: number;
  lowCents: number | null;
  highCents: number | null;
  avgCents: number | null;
} {
  if (priceHistory.length === 0) {
    return { daysTracked: 0, lowCents: null, highCents: null, avgCents: null };
  }
  const days = new Set(priceHistory.map((point) => point.date));
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const point of priceHistory) {
    low = Math.min(low, point.priceCents);
    high = Math.max(high, point.priceCents);
    sum += point.priceCents;
  }
  return {
    daysTracked: days.size,
    lowCents: low,
    highCents: high,
    avgCents: Math.round(sum / priceHistory.length),
  };
}

/**
 * Detector honesto de descuentos falsos sobre el listing ganador:
 *   a) Con >= 7 días de historial: el "antes" supera en >15% el máximo real
 *      visto en el historial.
 *   b) Descuento anunciado > 55%, o el "antes" supera en >40% el precio de la
 *      competencia en stock.
 */
function detectFakeDiscount(
  winner: StoreListingDTO | undefined,
  listings: StoreListingDTO[],
  historicalHighCents: number | null,
  daysTracked: number
): { flag: boolean; note: string | null } {
  if (
    !winner ||
    !winner.originalPriceCents ||
    winner.originalPriceCents <= winner.priceCents
  ) {
    return { flag: false, note: null };
  }

  const originalCents = winner.originalPriceCents;
  const discountPercent = ((originalCents - winner.priceCents) / originalCents) * 100;

  // a) "Antes" nunca visto en el historial reciente
  if (daysTracked >= 7 && historicalHighCents !== null) {
    if (originalCents > historicalHighCents * 1.15) {
      return {
        flag: true,
        note: "Este precio 'antes' no se registró en los últimos días de historial",
      };
    }
  }

  // b) Descuento inusualmente alto para el mercado local
  const cheapestCompetitorInStock = listings
    .filter((listing) => listing.inStock && listing.id !== winner.id)
    .reduce(
      (min, listing) => Math.min(min, listing.priceCents),
      Number.POSITIVE_INFINITY
    );

  const discountTooHigh = discountPercent > 55;
  const outOfMarket =
    cheapestCompetitorInStock !== Number.POSITIVE_INFINITY &&
    originalCents > cheapestCompetitorInStock * 1.4;

  if (discountTooHigh || outOfMarket) {
    return {
      flag: true,
      note: "Descuento anunciado inusualmente alto respecto al mercado local",
    };
  }

  return { flag: false, note: null };
}

/** Veredicto "¿Compro ahora o espero?" con textos honestos en español. */
function buyAdviceFor(
  input: PriceInsightInput,
  daysTracked: number,
  lowCents: number | null,
  avgCents: number | null
): { advice: PriceInsightDTO["buyAdvice"]; label: string } {
  // Ahorro multi-tienda en stock (solo si hay comparación real)
  const savingsPercent = roundSavingsPercent(
    input.savingsCents,
    input.highestPriceCents
  );

  if (daysTracked < 5) {
    if (savingsPercent >= 12) {
      return {
        advice: "buy-now",
        label: "Buen precio frente a otras tiendas hoy",
      };
    }
    return {
      advice: "collecting-history",
      label: `Acumulando historial diario (${daysTracked} día${
        daysTracked === 1 ? "" : "s"
      }) — crea una alerta para avisarte si baja`,
    };
  }

  // Con historial suficiente: comparar contra los datos reales
  if (lowCents !== null && input.bestPriceCents <= lowCents * 1.02) {
    return {
      advice: "buy-now",
      label: "Precio más bajo registrado en los últimos días",
    };
  }
  if (avgCents !== null && input.bestPriceCents >= avgCents * 1.08) {
    return {
      advice: "wait",
      label: "Por encima del promedio reciente — conviene esperar o activar alerta",
    };
  }
  return {
    advice: "fair-price",
    label: "Precio en rango normal del mercado",
  };
}

export function computePriceInsight(
  product: PriceInsightInput,
  listings: StoreListingDTO[],
  priceHistory: PriceHistoryPointDTO[]
): PriceInsightDTO {
  const { daysTracked, lowCents, highCents, avgCents } =
    historicalStats(priceHistory);

  const { flag, note } = detectFakeDiscount(
    listings[0],
    listings,
    highCents,
    daysTracked
  );

  const { advice, label } = buyAdviceFor(product, daysTracked, lowCents, avgCents);

  return {
    daysTracked,
    historicalLowCents: lowCents,
    historicalHighCents: highCents,
    historicalAvgCents: avgCents,
    fakeDiscountFlag: flag,
    fakeDiscountNote: note,
    buyAdvice: advice,
    buyAdviceLabel: label,
  };
}
