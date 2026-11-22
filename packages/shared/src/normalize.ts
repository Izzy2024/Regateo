import type { ProductCategory } from "./schemas";

const KNOWN_BRANDS = [
  "Samsung",
  "LG",
  "Sony",
  "Apple",
  "HP",
  "Dell",
  "Lenovo",
  "Asus",
  "Acer",
  "MSI",
  "Logitech",
  "Razer",
  "HyperX",
  "Corsair",
  "JBL",
  "Bose",
  "Hisense",
  "TCL",
  "Whirlpool",
  "Mabe",
  "Frigidaire",
  "GE",
  "Panasonic",
  "Philips",
  "Xiaomi",
  "Motorola",
  "Nintendo",
  "PlayStation",
  "Xbox",
  "Epson",
  "Canon",
  "Nikon",
  "Gree",
  "Sankey",
  "Nisato",
  "Oster",
  "Ninja",
  "Black+Decker",
  "Hamilton Beach",
  "TP-Link",
  "SanDisk",
  "Kingston",
  "Crucial",
  "Seagate",
  "Western Digital",
  "Cubitt",
  "Garmin",
  "Beko",
  "Bosch",
  "Electrolux",
  "Haier",
  "Honor",
  "Huawei",
];

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 110);
}

export function extractBrand(title: string, fallbackVendor?: string | null): string | null {
  const haystack = `${title} ${fallbackVendor ?? ""}`.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    const escaped = brand.toLowerCase().replace(/[+]/g, "\\+");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(haystack)) {
      return brand;
    }
  }
  if (fallbackVendor && fallbackVendor.trim().length >= 2 && fallbackVendor.trim().length <= 32) {
    return fallbackVendor.trim();
  }
  return null;
}

export function extractModelNumber(title: string, sku?: string | null): string | null {
  const candidates = `${title} ${sku ?? ""}`;
  // Match common electronics model codes (e.g. QN55Q60D, WH-1000XM5, WF20B9600, 15-FD0023LA, MX-MASTER-3S, RTX4060)
  const modelPatterns = [
    /\b([A-Z]{1,4}\d{2,4}[A-Z0-9-]{2,10})\b/,
    /\b(\d{2}[A-Z]{1,3}\d{2,4}[A-Z0-9-]{1,8})\b/,
    /\b([A-Z]{2,5}-\d{2,5}[A-Z0-9-]*)\b/,
  ];

  const ignored = new Set([
    "USB3",
    "HDMI2",
    "WIFI6",
    "DDR4",
    "DDR5",
    "SSD512",
    "1080P",
    "2160P",
    "4KUHD",
    "120HZ",
    "144HZ",
    "240HZ",
    "110V",
    "220V",
    "BTU12",
  ]);

  for (const regex of modelPatterns) {
    const match = candidates.toUpperCase().match(regex);
    if (match?.[1] && !ignored.has(match[1]) && match[1].length >= 5) {
      return match[1];
    }
  }

  return null;
}

export function classifyCategory(title: string, productType?: string | null): ProductCategory {
  const text = `${title} ${productType ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/(lavadora|secadora|refrigeradora|nevera|estufa|congelador|lavavajillas|centro de lavado|linea blanca)/.test(text)) {
    return "linea-blanca";
  }
  if (/(aire acondicionado|split|inverter.*btu|\bbtu\b|mini split)/.test(text)) {
    return "aires-acondicionados";
  }
  if (/(televisor|smart tv|\btv\b|oled|qled|uhd|nanocell|google tv|roku tv)/.test(text)) {
    return "televisores";
  }
  if (/(laptop|notebook|macbook|computadora|all-in-one|pc escritorio|chromebook|imac|desktop|monitor)/.test(text)) {
    return "computadoras";
  }
  if (/(mouse|raton|teclado|keyboard|webcam|headset|audifono gamer|mousepad|hub usb|dock)/.test(text)) {
    return "perifericos";
  }
  if (/(iphone|galaxy s|galaxy a|redmi|celular|smartphone|ipad|tablet|reloj inteligente|smartwatch)/.test(text)) {
    return "celulares";
  }
  if (/(playstation|ps5|xbox|nintendo|switch|consola|control dualsense|gamer|gaming)/.test(text)) {
    return "gaming";
  }
  if (/(bocina|parlante|barra de sonido|soundbar|audifono|auricular|airpods|microfono|subwoofer|audio|speaker)/.test(text)) {
    return "audio";
  }
  if (/(licuadora|microondas|freidora|air fryer|cafetera|plancha|aspiradora|batidora|tostadora|horno|abanico|ventilador)/.test(text)) {
    return "electrodomesticos";
  }
  return "accesorios";
}

export function buildMatchKey(input: {
  title: string;
  brand?: string | null;
  modelNumber?: string | null;
}): string {
  const brand = (input.brand ?? extractBrand(input.title) ?? "generic").toLowerCase().trim();
  const model = input.modelNumber ?? extractModelNumber(input.title);
  if (model) {
    return `${slugify(brand)}::${slugify(model)}`;
  }

  // Fallback normalized token signature for cross-store title matching
  const stopwords = new Set([
    "de", "la", "el", "en", "con", "para", "por", "y", "a", "un", "una",
    "panama", "original", "nuevo", "nueva", "oferta", "promo", "color",
    "negro", "blanco", "gris", "plata", "azul", "rojo", "pulgadas",
  ]);
  const tokens = slugify(input.title)
    .split("-")
    .filter((t) => t.length >= 2 && !stopwords.has(t))
    .slice(0, 6);

  return `${slugify(brand)}::${tokens.join("-")}`;
}

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("es-PA", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
