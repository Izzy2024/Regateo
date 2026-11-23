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

function normalizeForClassify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Clasifica un producto por su sujeto principal (título primero, `productType`
 * solo como desempate). Evita falsos positivos como "Teclado para Laptop" en
 * `computadoras`, "Cartucho de tinta" en `computadoras`, o "Funda para iPhone"
 * / "Smartwatch" / "Tablet" en `celulares`.
 */
export function classifyCategory(title: string, productType?: string | null): ProductCategory {
  const titleNorm = normalizeForClassify(title);
  // Cabeza del título (primeros 75 chars) para detectar el sujeto real del producto.
  const head = titleNorm.slice(0, 75);

  // 1. Consumibles, fundas, soportes, cables, cargadores y servicios -> accesorios
  //    (siempre antes de laptop/celular/tv porque dicen "para Laptop/iPhone/TV")
  const isConsumableOrAccessoryHead =
    /\b(tinta|cartucho|toner|botella de tinta|funda|carcasa|case|cover|protector|mica|vidrio templado|estuche|correa|soporte|brazo|stand|mount|base enfriadora|base para|cable|adaptador|cargador|power\s?bank|bateria externa|bateria para|repuesto|cambio\/instalacion|instalacion de|filtro de agua|bolsa para|mochila|maletin|memoria usb|pendrive|micro\s?sd|tarjeta sd|capturadora|regleta|protector de voltaje|ups)\b/.test(
      head
    );
  const isPrimaryComputerOrPhoneHead =
    /^(?:[a-z0-9+&'.\-]+\s+){0,2}(laptop|notebook|macbook|computadora?|pc\b|all[\s-]in[\s-]one|chromebook|imac|desktop|mini\s?pc|celular|smartphone|iphone|telefono|televisor|smart\s?tv|lavadora|secadora|refrigeradora|nevera|aire acondicionado)\b/.test(
      head
    );

  if (isConsumableOrAccessoryHead && !isPrimaryComputerOrPhoneHead) {
    return "accesorios";
  }

  // 2. Relojes inteligentes / wearables -> accesorios (nunca celulares)
  if (
    /\b(smartwatch|smart\s?watch|reloj inteligente|apple\s?watch|galaxy\s?watch|huawei\s?watch|xiaomi\s?watch|watch\s?(?:ultra|se|series|\d)|smart\s?band|mi\s?band|fitbit|garmin\s?(?:forerunner|fenix|venu|vivoactive|instinct))\b/.test(
      titleNorm
    ) &&
    !isPrimaryComputerOrPhoneHead
  ) {
    return "accesorios";
  }

  // 3. Periféricos e impresión (sujeto principal en cabeza del título)
  if (
    /\b(mouse|raton|teclado|keyboard|webcam|camara web|mousepad|alfombrilla|hub\s?usb|docking|impresora|multifuncional|escaner|scanner|router|repetidor|mesh\s?wi-?fi|switch\s?(?:de red|gigabit|poe))\b/.test(
      head
    ) &&
    !isPrimaryComputerOrPhoneHead
  ) {
    return "perifericos";
  }

  // 4. Línea blanca
  if (
    /\b(lavadora|secadora|refrigeradora|refrigerador|nevera|estufa|congelador|freezer|lavavajillas|centro de lavado|vinera|campana extractora|linea blanca)\b/.test(
      titleNorm
    )
  ) {
    return "linea-blanca";
  }

  // 5. Aires acondicionados
  if (/\b(aire acondicionado|mini\s?split|inverter.*\bbtu\b|\bbtu\b|aire\s+split)\b/.test(titleNorm)) {
    return "aires-acondicionados";
  }

  // 6. Televisores
  if (
    /\b(televisor|smart\s?tv|\btv\b|oled|qled|uhd|nanocell|google\s?tv|roku\s?tv|bravia)\b/.test(
      titleNorm
    ) &&
    !/\b(soporte|base|control remoto|cable|antena|mueble|rack|barra de sonido|soundbar)\b/.test(head)
  ) {
    return "televisores";
  }

  // 7. Gaming y consolas (antes de computadoras/audio para consolas y headsets gamer)
  if (
    /\b(playstation|ps5|ps4|xbox|nintendo\s?switch|consola|control\s+dualsense|dualsense|joy-?con|steam\s?deck|rog\s?ally)\b/.test(
      titleNorm
    )
  ) {
    return "gaming";
  }

  // 8. Computadoras, laptops, monitores y tablets/iPads (con borde de palabra: evita "tabletops")
  if (
    /\b(laptop|notebook|macbook|computadora?|all[\s-]in[\s-]one|pc\s+escritorio|chromebook|imac|mac\s?mini|desktop|mini\s?pc|monitor|tablet|tablets|ipad|galaxy\s?tab|lenovo\s?tab|honor\s?pad|redmi\s?pad|xiaomi\s?pad)\b/.test(
      titleNorm
    )
  ) {
    return "computadoras";
  }

  // 9. Celulares / Smartphones únicamente (sin tablets ni relojes ni fundas)
  if (
    /\b(celular|smartphone|iphone|galaxy\s?(?:s\d|a\d|z\s?(?:fold|flip)|m\d|note)|redmi\s?(?:note|\d|a\d)|poco\s?[xfmc]\d|moto\s?[ge]\d|motorola\s?(?:edge|razr|moto)|honor\s?(?:magic|x\d|\d{2,3})|xiaomi\s?1\d|tecno\s?(?:spark|camon|pova)|infinix\s?(?:hot|note|smart|gt)|realme\s?(?:c\d|\d)|pixel\s?\d)\b/.test(
      titleNorm
    )
  ) {
    return "celulares";
  }

  // 10. Periféricos en el resto del título
  if (
    /\b(mouse|raton|teclado|keyboard|webcam|headset|audifono gamer|mousepad|hub\s?usb|dock|impresora|escaner|router)\b/.test(
      titleNorm
    )
  ) {
    return "perifericos";
  }

  // 11. Audio y sonido
  if (
    /\b(bocina|parlante|barra de sonido|soundbar|audifono|audifonos|auricular|auriculares|airpods|earbuds|microfono|subwoofer|torre de sonido|minicomponente|home\s?theater|speaker|tocadiscos|amplificador)\b/.test(
      titleNorm
    )
  ) {
    return "audio";
  }

  // 12. Electrodomésticos / Hogar
  if (
    /\b(licuadora|microondas|freidora|air\s?fryer|cafetera|plancha|aspiradora|batidora|tostadora|horno|abanico|ventilador|arrocera|olla|sandwichera|procesador de alimentos|extractor de jugo|hervidor|waflera|dispensador de agua|purificador|deshumidificador|humidificador)\b/.test(
      titleNorm
    )
  ) {
    return "electrodomesticos";
  }

  // 13. Desempate opcional por productType de la tienda solo si el título no matcheó nada
  const typeNorm = normalizeForClassify(productType ?? "");
  if (/\b(linea blanca|lavadora|refrigeradora)\b/.test(typeNorm)) return "linea-blanca";
  if (/\b(aire|climatizacion)\b/.test(typeNorm)) return "aires-acondicionados";
  if (/\b(televisor|tv)\b/.test(typeNorm)) return "televisores";
  if (/\b(gaming|consola|videojuego)\b/.test(typeNorm)) return "gaming";
  if (/\b(audio|sonido)\b/.test(typeNorm)) return "audio";
  if (/\b(electrodomestico|hogar|cocina)\b/.test(typeNorm)) return "electrodomesticos";
  if (/\b(periferico|impresora)\b/.test(typeNorm)) return "perifericos";

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
