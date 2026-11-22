import { describe, expect, test } from "bun:test";
import { calculateAmazonPanamaImport } from "@regateo/shared";
import { shouldTriggerAlert } from "./alerts";
import { formatChannelDealsText, type ChannelDeal } from "./digest";

/* -------------------------------------------------------------------------- */
/* Calculadora de importación Amazon → Panamá                                  */
/* -------------------------------------------------------------------------- */

describe("calculateAmazonPanamaImport: breakdown", () => {
  test("TV pesada (38 lb): flete alto y verdict buy-local", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 400,
      localBestPriceCents: 50_000,
      weightLbs: 38,
    });
    expect(result.breakdown.itemCents).toBe(40_000);
    expect(result.breakdown.shippingCents).toBe(13_300);
    expect(result.breakdown.customsAndItbmsCents).toBe(6_396);
    expect(result.breakdown.handlingCents).toBe(450);
    expect(result.totalLandedCents).toBe(60_146);
    expect(result.verdict).toBe("buy-local");
  });

  test("gadget liviano (<$100 CIF) no paga impuestos aduanales", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 50,
      localBestPriceCents: 8_000,
      weightLbs: 1,
    });
    expect(result.breakdown.customsAndItbmsCents).toBe(0);
    expect(result.breakdown.shippingCents).toBe(350);
    expect(result.totalLandedCents).toBe(5_800);
    expect(result.deltaCents).toBe(-2_200);
    expect(result.verdict).toBe("import");
  });

  test("CIF > $100 aplica el estimado de 12%", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 200,
      localBestPriceCents: 45_000,
      weightLbs: 5,
    });
    expect(result.breakdown.shippingCents).toBe(1_750);
    expect(result.breakdown.customsAndItbmsCents).toBe(2_610);
    expect(result.totalLandedCents).toBe(24_810);
    expect(result.verdict).toBe("import");
  });

  test("precio local cercano produce verdict similar", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 100,
      localBestPriceCents: 12_500,
      weightLbs: 2,
    });
    expect(result.totalLandedCents).toBe(12_434);
    expect(result.deltaCents).toBe(-66);
    expect(result.verdict).toBe("similar");
  });

  test("aplica usTaxPercent cuando se declara", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 100,
      localBestPriceCents: 20_000,
      weightLbs: 1,
      usTaxPercent: 8,
    });
    expect(result.breakdown.usTaxCents).toBe(800);
    expect(result.totalLandedCents).toBe(12_842);
  });

  test("respeta handling fee personalizado", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 100,
      localBestPriceCents: 20_000,
      weightLbs: 1,
      handlingFeeUsd: 10,
    });
    expect(result.breakdown.handlingCents).toBe(1_000);
    expect(result.totalLandedCents).toBe(12_592);
  });

  test("peso mínimo 0.5 lb se redondea a 1 lb de courier", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 20,
      localBestPriceCents: 5_000,
      weightLbs: 0,
    });
    expect(result.breakdown.shippingCents).toBe(350);
  });

  test("local muy caro produce verdict import", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 300,
      localBestPriceCents: 100_000,
      weightLbs: 2,
    });
    expect(result.totalLandedCents).toBe(34_834);
    expect(result.verdict).toBe("import");
  });

  test("delta positivo significa que Panamá es más barato", () => {
    const result = calculateAmazonPanamaImport({
      amazonPriceUsd: 400,
      localBestPriceCents: 50_000,
      weightLbs: 38,
    });
    expect(result.deltaCents).toBeGreaterThan(0);
    expect(result.verdict).toBe("buy-local");
  });

  test("eco del precio local y notas explicativas", () => {
    const heavy = calculateAmazonPanamaImport({
      amazonPriceUsd: 400,
      localBestPriceCents: 50_000,
      weightLbs: 38,
    });
    expect(heavy.localBestPriceCents).toBe(50_000);
    expect(heavy.notes.some((note) => note.includes("Artículo pesado"))).toBe(true);
    expect(heavy.notes.some((note) => note.includes("Incluye estimado"))).toBe(true);

    const light = calculateAmazonPanamaImport({
      amazonPriceUsd: 50,
      localBestPriceCents: 8_000,
      weightLbs: 1,
    });
    expect(light.notes.some((note) => note.includes("Por debajo de $100"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Reglas puras de alertas                                                     */
/* -------------------------------------------------------------------------- */

const alertBase = {
  active: true,
  verified: true,
  inStock: true,
  targetPriceCents: 10_000,
  bestPriceCents: 9_999,
  lastTriggeredAt: null as Date | string | null,
};

describe("shouldTriggerAlert", () => {
  test("dispara con alerta verificada, stock y precio bajo el objetivo", () => {
    expect(shouldTriggerAlert(alertBase)).toBe(true);
  });

  test("dispara cuando el precio es exactamente el objetivo", () => {
    expect(shouldTriggerAlert({ ...alertBase, bestPriceCents: 10_000 })).toBe(true);
  });

  test("no dispara si la alerta no está verificada", () => {
    expect(shouldTriggerAlert({ ...alertBase, verified: false })).toBe(false);
  });

  test("no dispara si la alerta está inactiva", () => {
    expect(shouldTriggerAlert({ ...alertBase, active: false })).toBe(false);
  });

  test("no dispara si el producto no tiene stock", () => {
    expect(shouldTriggerAlert({ ...alertBase, inStock: false })).toBe(false);
  });

  test("no dispara sin precio disponible", () => {
    expect(shouldTriggerAlert({ ...alertBase, bestPriceCents: null })).toBe(false);
  });

  test("no dispara con precio cero", () => {
    expect(shouldTriggerAlert({ ...alertBase, bestPriceCents: 0 })).toBe(false);
  });

  test("no dispara cuando el precio supera el objetivo", () => {
    expect(shouldTriggerAlert({ ...alertBase, bestPriceCents: 10_001 })).toBe(false);
  });

  test("deduplica disparos dentro de 24 h", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    const lastTriggeredAt = new Date("2026-01-10T11:00:00Z");
    expect(shouldTriggerAlert({ ...alertBase, now, lastTriggeredAt })).toBe(false);
  });

  test("vuelve a disparar pasadas 24 h", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    const lastTriggeredAt = new Date("2026-01-09T11:00:00Z");
    expect(shouldTriggerAlert({ ...alertBase, now, lastTriggeredAt })).toBe(true);
  });

  test("acepta cooldown personalizado", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(
      shouldTriggerAlert({
        ...alertBase,
        now,
        cooldownHours: 2,
        lastTriggeredAt: new Date("2026-01-10T09:00:00Z"),
      })
    ).toBe(true);
  });

  test("interpreta lastTriggeredAt como string ISO", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(
      shouldTriggerAlert({
        ...alertBase,
        now,
        lastTriggeredAt: "2026-01-10T11:30:00.000Z",
      })
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Formato del mensaje de canal WhatsApp/Telegram                              */
/* -------------------------------------------------------------------------- */

const deal = (overrides: Partial<ChannelDeal> = {}): ChannelDeal => ({
  productName: 'Televisor Samsung 55" U8000F 4K',
  bestPriceCents: 26_995,
  storeName: "Panafoto",
  savingsCents: 2_004,
  savingsPercent: 6.9,
  storeCount: 2,
  bestListingId: "listing-123",
  ...overrides,
});

describe("formatChannelDealsText", () => {
  test("incluye título, precio, tienda, ahorro y enlace medido", () => {
    const text = formatChannelDealsText([deal()], { apiUrl: "https://api.regateo.app" });
    expect(text).toContain("Ofertas verificadas en Panamá");
    expect(text).toContain('Televisor Samsung 55" U8000F 4K');
    expect(text).toContain("$269.95 en Panafoto");
    expect(text).toContain("Ahorras $20.04 (6.9%) vs 2 tiendas");
    expect(text).toContain("https://api.regateo.app/out/listing-123?src=whatsapp");
  });

  test("numera las ofertas y respeta el límite", () => {
    const deals = [
      deal({ bestListingId: "a" }),
      deal({ bestListingId: "b", productName: "Segundo producto" }),
      deal({ bestListingId: "c", productName: "Tercer producto" }),
    ];
    const text = formatChannelDealsText(deals, { apiUrl: "https://api.x", limit: 2 });
    expect(text).toContain("1. *");
    expect(text).toContain("2. *");
    expect(text).not.toContain("3. *");
    expect(text.split("👉").length - 1).toBe(2);
  });

  test("normaliza apiUrl con slash final", () => {
    const text = formatChannelDealsText([deal()], { apiUrl: "https://api.regateo.app/" });
    expect(text).toContain("https://api.regateo.app/out/listing-123?src=whatsapp");
  });

  test("usa el default de 5 ofertas cuando no se especifica límite", () => {
    const deals = Array.from({ length: 8 }, (_, index) =>
      deal({ bestListingId: `id-${index}`, productName: `Producto ${index}` })
    );
    const text = formatChannelDealsText(deals, { apiUrl: "https://api.x" });
    expect(text.split("👉").length - 1).toBe(5);
  });

  test("mensaje claro cuando no hay ofertas", () => {
    const text = formatChannelDealsText([], { apiUrl: "https://api.x" });
    expect(text).toContain("no hay ofertas con ahorro verificado");
    expect(text).toContain("RegateoApp");
  });

  test("redondea porcentajes con un decimal", () => {
    const text = formatChannelDealsText(
      [deal({ savingsPercent: 16.67 })],
      { apiUrl: "https://api.x" }
    );
    expect(text).toContain("(16.7%)");
  });

  test("incluye el pie de página de comparación local", () => {
    const text = formatChannelDealsText([deal()], { apiUrl: "https://api.x" });
    expect(text).toContain("Compras locales, garantía local");
  });
});
