import type { ProductCategory } from "./schemas";

export const DEFAULT_WEIGHT_LBS_BY_CATEGORY: Record<ProductCategory, number> = {
  celulares: 1.0,
  perifericos: 1.5,
  audio: 2.5,
  accesorios: 1.0,
  gaming: 8.0,
  computadoras: 5.5,
  electrodomesticos: 12.0,
  televisores: 38.0,
  "aires-acondicionados": 85.0,
  "linea-blanca": 140.0,
};

export interface AmazonPanamaImportInput {
  amazonPriceUsd: number;
  localBestPriceCents: number;
  weightLbs: number;
  courierRatePerLbUsd?: number;
  usTaxPercent?: number;
  handlingFeeUsd?: number;
}

export interface AmazonPanamaImportResult {
  totalLandedCents: number;
  localBestPriceCents: number;
  deltaCents: number; // > 0 => comprar en Panamá es más barato; < 0 => importar sale más barato
  verdict: "buy-local" | "import" | "similar";
  breakdown: {
    itemCents: number;
    usTaxCents: number;
    shippingCents: number;
    customsAndItbmsCents: number;
    handlingCents: number;
  };
  notes: string[];
}

/**
 * Estima el costo puesto en Panamá (CIF + courier aéreo Miami→Panamá + ITBMS/aduana)
 * para ayudar al comprador panameño a decidir si conviene comprar localmente o importar.
 */
export function calculateAmazonPanamaImport(
  input: AmazonPanamaImportInput
): AmazonPanamaImportResult {
  const amazonPriceUsd = Math.max(0, input.amazonPriceUsd);
  const weightLbs = Math.max(0.5, input.weightLbs);
  const courierRate = input.courierRatePerLbUsd ?? 3.5; // tarifa aérea estándar Miami -> PTY
  const usTaxPercent = input.usTaxPercent ?? 0; // 0% con dirección tax-free de courier en Miami
  const handlingFeeUsd = input.handlingFeeUsd ?? 4.5;

  const itemCents = Math.round(amazonPriceUsd * 100);
  const usTaxCents = Math.round(itemCents * (usTaxPercent / 100));
  const shippingCents = Math.round(Math.ceil(weightLbs) * courierRate * 100);
  const handlingCents = Math.round(handlingFeeUsd * 100);

  // En Panamá, compras CIF > $100 suelen pagar 7% ITBMS + arancel promedio estimado (~5% para electrónica/hogar)
  const cifCents = itemCents + shippingCents;
  const customsAndItbmsCents =
    cifCents > 10000 ? Math.round(cifCents * 0.12) : 0;

  const totalLandedCents =
    itemCents + usTaxCents + shippingCents + customsAndItbmsCents + handlingCents;

  const deltaCents = totalLandedCents - input.localBestPriceCents;
  const thresholdCents = Math.max(1000, Math.round(input.localBestPriceCents * 0.05));

  let verdict: AmazonPanamaImportResult["verdict"] = "similar";
  if (deltaCents > thresholdCents) verdict = "buy-local";
  else if (deltaCents < -thresholdCents) verdict = "import";

  const notes: string[] = [];
  if (weightLbs >= 25) {
    notes.push("Artículo pesado/voluminoso: el flete aéreo suele encarecer mucho la importación.");
  }
  if (cifCents > 10000) {
    notes.push("Incluye estimado de ~12% (7% ITBMS + arancel referencial para CIF > $100).");
  } else {
    notes.push("Por debajo de $100 CIF normalmente aplica exoneración de impuestos de importación.");
  }
  notes.push("Comprar en Panamá incluye entrega inmediata y garantía local oficial.");

  return {
    totalLandedCents,
    localBestPriceCents: input.localBestPriceCents,
    deltaCents,
    verdict,
    breakdown: {
      itemCents,
      usTaxCents,
      shippingCents,
      customsAndItbmsCents,
      handlingCents,
    },
    notes,
  };
}
