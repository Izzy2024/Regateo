import {
  buildMatchKey,
  classifyCategory,
  extractBrand,
  extractModelNumber,
  slugify,
  type ProductCategory,
} from "@regateo/shared";

/**
 * Panama specific product identity resolution.
 *
 * `@regateo/shared` provides the canonical primitives (`extractBrand`,
 * `extractModelNumber`, `classifyCategory`, `buildMatchKey`). This module wraps
 * them with the extra rules required by real Panamanian retail catalogs:
 *
 * - Store SKUs (Multimax `PSN0117366`, Titán numeric ids, Rodelag EAN/UPC) must
 *   never be mistaken for manufacturer model numbers, otherwise two stores can
 *   never be matched.
 * - TV models repeat across sizes (`S90F` exists in 55/65/77"), so the screen
 *   size must be part of the match key to avoid merging different products.
 * - When no reliable model exists (small appliances) we fall back to a
 *   brand + appliance type + capacity family key, which is what customers
 *   actually compare ("Lavadora Samsung 20kg").
 */

const UNIT_AND_SPEC_NOISE = new Set([
  "4K", "8K", "2K", "UHD", "FHD", "QHD", "HD", "HDR", "HDR10", "QLED", "OLED",
  "MINI", "LED", "LCD", "NANO", "NEQ", "SMART", "WIFI", "WIFI6", "BT", "HDMI",
  "USB", "HZ", "GHZ", "MHZ", "GB", "TB", "MB", "RAM", "ROM", "SSD", "HDD",
  "NVME", "BTU", "MAH", "WH", "KWH", "PULG", "PULGADAS", "IN", "INCH", "KG",
  "LBS", "PC", "FT", "FT3", "CU", "V", "VA", "W", "KW", "AMP", "A", "VOLT",
  "AC", "DC", "USB-C", "TYPE-C", "IPX7", "IPX5", "IP68", "DVBT", "DVBT2",
  "ANDROID", "IOS", "TIZEN", "WEBOS", "VIDAA", "ROKU", "GOOGLE", "ALEXA",
  "DOLBY", "ATMOS", "DTS", "HDCP", "ARC", "EARC", "MS", "FPS", "RGB", "PRO",
  "PLUS", "MAX", "NEW", "SET", "KIT", "2EN1", "3EN1", "GEN1", "GEN2", "GEN3", "GEN4", "GEN5", "GEN",
  "W10", "W11", "WIN10", "WIN11", "W7", "W8", "M-2", "M.2", "NVME-2",
]);

const STORE_SKU_PATTERNS = [
  /^PSN\d{4,}$/i, // Multimax
  /^SKU\d+$/i,
  /^\d{7,14}$/, // Titán numeric ids and EAN/UPC codes
];

const UPC_EAN = /^\d{12,14}$/;

const NON_ELECTRONICS =
  /(juguete|cometa|mu[nñ]ec|peluche|rompecabezas|did[aá]ctic|ropa|blusa|camisa|pantal|short|vestido|zapat|sandalia|calzado|tenis|bolso|cartera|maquillaje|perfume|crema|shampoo|cepillo dental|mascota|alimento|snack|comida|bebida|licor|cerveza|refresco|papel higi[eé]nico|detergente|jab[oó]n|cloro|desinfectante|escoba|trapeador|basurero|maceta|planta|mueble|sof[aá]|sill[oó]n|comedor|colch[oó]n|cama|almohada|s[aá]bana|toalla|cortina|alfombra|adorno|navidad|halloween|mochila|maleta|bicicleta|pesas|mancuerna|caminadora|carpa|piscina|inflable|taladro|sierra|pintura|jard[ií]n|grifo|tornillo|bombillo|foco|extensi[oó]n|paraguas|papeler[ií]a|cuaderno|l[aá]piz|libro|jugo)/i;

/**
 * Accessories share model codes with the device they belong to ("Funda Galaxy
 * A37" vs "Galaxy A37"), so they get their own `acc-` match-key namespace.
 * Only the leading segment is inspected: a printer titled "…Cartuchos
 * compatibles PG-145" is still a printer, not a cartridge.
 */
const ACCESSORY_HEAD =
  /^(?=[\s\S]{0,90})(?:[a-z0-9+&'.\-]+\s+){0,4}(funda|carcasa|case|protector|mica|vidrio templado|templado|estuche|correa|banda|strap|stylus|l[aá]piz [oó]ptico|adaptador|cable|cargador|soporte|brazo|stand|mount|base para|kit de|repuesto|tinta|t[oó]ner|cartucho|filtro de agua|bolsa|hub|dock|mousepad|almohadilla|forro)\b/i;

const ELECTRONICS_CUES =
  /(televisor|tv\b|smart tv|monitor|proyector|laptop|notebook|computadora|desktop|all in one|tablet|ipad|c[aá]mara|gopro|drone|aud[ií]fono|auricular|headset|bocina|parlante|barra de sonido|soundbar|subwoofer|amplificador|receptor|tocadiscos|consola|playstation|xbox|nintendo|control|mando|cargador|power bank|cable|adaptador|hub|mouse|rat[oó]n|teclado|webcam|impresora|tinta|t[oó]ner|router|repetidor|memoria|disco|ssd|nvr|dvr|smartwatch|reloj inteligente|celular|smartphone|iphone|galaxy|aire acondicionado|ventilador|abanico|nevera|refrigeradora|lavadora|secadora|estufa|horno|microondas|licuadora|cafetera|freidora|air fryer|aspiradora|batidora|tostadora|arrocera|olla|plancha|sandwichera|procesador de alimentos|centro de lavado|congelador|lavavajillas|refrigerador|refri\b|freezer|french door|side by side|cu\.?\s?ft|laundry|torre de sonido|minicomponente|equipo de sonido|home theater|cocina a gas|cocina el[eé]ctrica|cocina de gas|hornilla|parrilla (?:de cocina|empotrable|el[eé]ctrica)|campana\s+(?:\w+\s+){0,2}(?:extractora|de pared|de cocina)|extractor de (?:grasa|jugo)|odyssey\s+(?:neo\s+)?g\d|jet bot|vinera|purificador de agua|calentador|deshumidificador|humidificador|lavadora de platos|centro de entretenimiento|pies c[uú]bicos|quemador)/i;

const ACCESSORY_CUES =
  /(aud[ií]fono|auricular|bocina|parlante|cargador|cable|mouse|rat[oó]n|teclado|webcam|hub|adaptador|memoria|disco|ssd|monitor|impresora|tinta|t[oó]ner|router|soporte|control|mando|funda|protector|power bank|bater[ií]a|proyector|c[aá]mara)/i;

export interface ParsedIdentity {
  brand: string | null;
  modelNumber: string | null;
  category: ProductCategory;
  matchKey: string;
  sharedMatchKey: string;
  canonicalName: string;
  specs: Record<string, unknown>;
  strategy: "gtin" | "family" | "model" | "signature";
}

export interface IdentityInput {
  title: string;
  vendor?: string | null;
  sku?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  storeSlug?: string;
  /**
   * Manufacturer model supplied by the store API (Ptytec exposes a `model`
   * field). Trusted over title parsing when it looks like a real model code.
   */
  modelNumber?: string | null;
  /**
   * Whether the store SKU may be used as a model fallback. Do it Center encodes
   * `{3-digit department}{model}` in the SKU, so its adapter pre-processes the
   * value and disables the raw fallback.
   */
  trustSku?: boolean;
  /** GTIN/EAN/UPC supplied by the store (Shopify `variant.barcode`). */
  gtin?: string | null;
}

/** Parses `$ 1,299.97`, `B/. 124.99`, `1249.97` or a numeric value into cents. */
export function parsePriceToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  }
  // Drop currency markers first: "B/." would otherwise leak a decimal dot.
  const withoutCurrency = value.replace(/US\$|B\/\s*\.|B\/|USD|\$/gi, " ").trim();
  const numericMatch = withoutCurrency.match(/\d[\d.,]*/);
  if (!numericMatch) return null;

  let text = numericMatch[0].replace(/[.,]+$/, "");
  if (!text) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) {
    // 1.299,97 (comma decimal)
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    // 1,299.97 (dot decimal)
    text = text.replace(/,/g, "");
  }

  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

/** First USD-looking price found inside a free text fragment (`$ 124.99`, `B/. 99.00`). */
export function findUsdPriceCents(text: string): number | null {
  const match = text.match(/(?:US\$|B\/\.|\$)\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/);
  if (!match?.[1]) return null;
  return parsePriceToCents(match[1]);
}

function normalizeToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").toUpperCase();
}

function tokensOf(text: string): string[] {
  return text
    .split(/[\s|/·,;()[\]{}]+/)
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

/** A token that looks like a manufacturer model code rather than a spec or store SKU. */
export function looksLikeModelToken(token: string): boolean {
  const normalized = normalizeToken(token);
  if (normalized.length < 3 || normalized.length > 26) return false;
  if (UNIT_AND_SPEC_NOISE.has(normalized)) return false;
  if (UPC_EAN.test(normalized)) return false;
  if (STORE_SKU_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (!/[A-Z]/.test(normalized) || !/\d/.test(normalized)) return false;
  // Reject number + unit tokens: 9.42PC, 0.7PC, 1.8L, 700W, 50MP, 4GB, 65IN…
  if (
    /^\d+(?:[.,]\d+)?(GHZ|MHZ|KHZ|HZ|G|PCS?|LTS?|L|ML|KGS?|LBS?|WATTS?|W|KW|VA?|VRMS|RMS|BTUS?|GB|TB|MB|MAH|WH|KWH|INCHES?|INCH|IN|PULG|PULGADAS|AMPS?|A|FT3|FT|CU|CM|MM|MP|LUMENS?|X)$/.test(
      normalized
    )
  ) {
    return false;
  }
  // Reject resolution tokens (1080P, 2160P, 4K) and 4-digit CPU codes (7520U, 1315U)
  if (/^\d{3,4}P$/.test(normalized)) return false;
  if (/^\d{4}[A-Z]{1,2}$/.test(normalized)) return false;
  if (/^\d{2,4}HZ$/.test(normalized)) return false;
  // CPU/embedded part codes (E-2434, I5-1235U, R7-7730U) are not product models.
  if (/^[A-Z]{1,2}-\d{3,4}$/.test(normalized)) return false;
  if (/^[IR][3579]-?\d{4,5}[A-Z]{0,3}$/.test(normalized)) return false;
  // Panel specs (1MS, 165HZ, 8BIT) are not models either.
  if (/^\d{1,3}(?:MS|FPS|BIT)$/.test(normalized)) return false;
  // Voltage ranges (100V-240V, 110-220VAC) describe power, not a product model.
  if (/^\d{2,4}V(?:AC|DC)?(?:[-~/]\d{2,4}V(?:AC|DC)?)?$/.test(normalized)) return false;
  // Frequency bands (2.4GHZ, 5GHZ) are specs, not models.
  if (/^\d+(?:[.,]\d+)?(?:GHZ|MHZ|KHZ|G)$/.test(normalized)) return false;
  // Wi-Fi speed classes (AX1800, AC1200, N300) are not unique models.
  if (/^(?:AX|AC|AXE|BE|N)\d{3,4}$/.test(normalized)) return false;
  // Ingress protection ratings (IPX4, IP67) are specs, not models.
  if (/^IPX?\d{1,2}$/.test(normalized)) return false;
  // Generation markers (GEN11) and M.2 style storage slots are not models.
  if (/^GEN\d{1,2}$/.test(normalized)) return false;
  if (/^M\.?2$/.test(normalized)) return false;
  // Reject HDMI2.1 / USB3.0 style spec tokens
  if (/^(HDMI|USB|DP|DDR|PCIE|SATA|NVME|WIFI|BT)\d/.test(normalized)) return false;
  return true;
}

/** Best-effort manufacturer model detection that ignores store SKUs. */
export function extractTrustedModel(input: IdentityInput): string | null {
  const brandToken = normalizeToken(
    extractPanamaBrand(input.title, input.vendor ?? null) ?? input.vendor ?? ""
  );
  const titleTokens = tokensOf(input.title);
  for (const token of titleTokens) {
    if (brandToken && normalizeToken(token) === brandToken) continue;
    if (looksLikeModelToken(token)) return token;
  }

  // Try the shared extractor (may catch hyphenated codes like NE-7630RNPHFMS)
  const shared = extractModelNumber(input.title);
  if (shared && looksLikeModelToken(shared)) return shared;

  // Only trust the SKU when it clearly is a manufacturer code
  const sku = input.trustSku === false ? null : input.sku?.trim();
  if (
    sku &&
    looksLikeModelToken(sku) &&
    !UPC_EAN.test(sku) &&
    !/^\d+$/.test(sku) &&
    !/^PSN/i.test(sku)
  ) {
    return normalizeToken(sku);
  }

  return null;
}

export function extractScreenSizeInches(title: string): number | null {
  const explicit = title.match(/(\d{2,3})\s*(?:"|”|''|pulgadas|pulg\.?|inch(?:es)?|in\b)/i);
  if (explicit?.[1]) {
    const size = Number.parseInt(explicit[1], 10);
    if (size >= 13 && size <= 120) return size;
  }
  return null;
}

export function extractCapacityKg(title: string): number | null {
  const match = title.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:kg|kilos?|kilogramos?)\b/i);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function extractCapacityCuFt(title: string): number | null {
  const match = title.match(
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:pc\b|pies?\s*c[uú]bicos?|cu\.?\s*ft|ft3|p3\b)/i
  );
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function extractBtu(title: string): number | null {
  const match = title.match(/(\d{1,2}[.,]?\d{3}|\d{4,5})\s*(?:btu|btus)\b/i);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1].replace(/[.,]/g, ""), 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Brand family inference: several Panamanian stores omit the manufacturer in the
 * title ("iPhone 17 512GB", "Galaxy S25 FE"), which used to produce keys like
 * `generic-panafoto::...` and lose every cross-store comparison.
 */
const BRAND_FAMILIES: Array<[RegExp, string]> = [
  [/\b(iphone|ipad|macbook|airpods|apple\s?watch|imac|mac\s?mini|mac\s?studio)\b/i, "Apple"],
  [/\b(galaxy|qled|crystal\s?uhd|neo\s?qled|odyssey|bespoke)\b/i, "Samsung"],
  [/\b(redmi|poco|mi\s?tv|xiaomi)\b/i, "Xiaomi"],
  [/\b(bravia|playstation|ps5|dualsense|cybershot)\b/i, "Sony"],
  [/\b(ideapad|thinkpad|legion|yoga|loq)\b/i, "Lenovo"],
  [/\b(pavilion|victus|probook|envy|elitebook|omen)\b/i, "HP"],
  [/\b(vivobook|zenbook|tuf\s?gaming|rog\b)/i, "Asus"],
  [/\b(inspiron|latitude|xps|alienware)\b/i, "Dell"],
  [/\b(nitro|predator|aspire|swift)\b/i, "Acer"],
  [/\b(instaview|qned|nanocell|thinq|xboom)\b/i, "LG"],
  [/\b(nintendo\s?switch|joy-?con)\b/i, "Nintendo"],
  [/\bxbox\b/i, "Microsoft"],
  [/\b(powershot|pixma|eos\b)/i, "Canon"],
  [/\becotank\b/i, "Epson"],
  [/\b(air\s?fryer\s+ninja|licuadora[^|]{0,40}ninja)\b/i, "Ninja"],
];

/** Infers the manufacturer from a model-family word when the brand is absent. */
export function inferBrandFromFamily(title: string): string | null {
  const haystack = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [pattern, brand] of BRAND_FAMILIES) {
    if (pattern.test(haystack)) return brand;
  }
  return null;
}

/**
 * Color names are a purchase variant, not a product identity: two colors of the
 * same iPhone are the same comparable product and must share a key.
 */
const COLOR_TOKENS = [
  "negro", "negra", "blanco", "blanca", "gris", "plata", "plateado", "plateada",
  "azul", "rojo", "roja", "verde", "rosa", "dorado", "dorada", "transparente",
  "titani", "titanio", "morado", "lavanda", "grafito", "midnight", "starlight",
  "ultramarine", "desert", "natural", "black", "white", "blue", "pink", "green",
  "silver", "gold", "gray", "grey", "teal", "purpura", "violeta", "naranja",
  "amarillo", "celeste", "coral", "menta", "crema", "beige", "marron", "caqui",
] as const;

/** Commercial/telecom suffixes that never differentiate the device model. */
const COMMERCIAL_NOISE = [
  "sf", "esim", "e-sim", "5g", "4g", "lte", "liberado", "desbloqueado", "dual",
  "sim", "global", "version", "nuevo", "sellado", "original",
] as const;

const COLOR_SET = new Set<string>(COLOR_TOKENS);
const COMMERCIAL_SET = new Set<string>(COMMERCIAL_NOISE);

/** First color mentioned in the title (stored in `specs.color`). */
export function extractColor(title: string): string | null {
  const tokens = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/);
  for (const token of tokens) {
    if (COLOR_SET.has(token)) return token;
  }
  return null;
}

/** Validates and normalizes a GTIN/EAN/UPC (8–14 numeric digits). */
export function normalizeGtin(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).replace(/[^0-9]/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

/**
 * Brands commonly sold in Panama that are missing from the shared list.
 * Kept here (scraper-owned) so `@regateo/shared` stays untouched.
 */
const PANAMA_EXTRA_BRANDS = [
  "Midea", "Lasko", "Havit", "Tronix", "Selectron", "Premier", "NST", "Mystic",
  "Karcher", "Forza", "Insta360", "Harman Kardon", "RCA", "Sankey", "Nisato",
  "Chargestone", "Chargeworx", "Maxell", "Sunstech", "Kalley", "Challenger",
  "Condesa", "Haceb", "Abba", "Recampro", "Koblenz", "Taurus", "Imusa",
  "General Electric", "Blue Star", "BlueStar", "Steren", "Bose", "Anker",
  "Soundcore", "Sonos", "Sennheiser", "Audio-Technica", "Beats", "Marshall",
  "Huawei", "Realme", "Oppo", "Vivo", "Tecno", "Infinix", "Zte", "Nokia",
  "Aoc", "Viewsonic", "Benq", "Gigabyte", "Zotac", "Radeon", "Nvidia", "Roku", "Chromecast", "Echo", "Kindle", "Xiaomi", "Poco", "Compaq", "Vaio", "Alienware", "Razer", "Corsair", "Redragon", "Genius", "Trust", "Ugreen", "Baseus", "Wacom", "Epson", "Brother", "Kyocera", "Ricoh",
  // Marcas frecuentes en el mercado gamer/corporativo de Panamá
  "Microsoft", "T-Vision", "TVision", "DarkFlash", "Dahua", "Hikvision", "Ezviz", "Imou",
  "Zkteco", "Velec", "AON", "MJK", "ENCOM", "VCOM", "Cyntech", "Beelink", "Teros", "Peak",
  "Startech", "StarTech", "Vertiv", "Tripp Lite", "Ubiquiti", "Mikrotik", "Grandstream",
  "Yealink", "Panduit", "Siemon", "Furukawa", "Nexxt", "Toshiba", "Adata", "Orico",
  "Teamgroup", "Team Group", "Hitachi", "Kensington", "Microsoft", "Logitech G",
];

/** Brand detection that also understands Panama-exclusive brands. */
export function extractPanamaBrand(title: string, vendor?: string | null): string | null {
  const shared = extractBrand(title, vendor ?? null);
  if (shared) return shared;

  const haystack = `${title} ${vendor ?? ""}`;
  for (const brand of PANAMA_EXTRA_BRANDS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(haystack)) return brand;
  }
  // Store vendor is a reliable manufacturer signal in Shopify; the family
  // dictionary is the fallback for stores that omit the brand (Panafoto).
  if (vendor && vendor.trim().length >= 2 && vendor.trim().length <= 32) {
    return titleCase(vendor.trim());
  }
  const family = inferBrandFromFamily(title);
  if (family) return family;
  return null;
}

const APPLIANCE_KINDS: Array<[RegExp, string]> = [
  [/lavadora|centro de lavado|lavasecadora/, "lavadora"],
  [/secadora/, "secadora"],
  [/refrigeradora|nevera|refrigerador|frigor[ií]fico/, "refrigeradora"],
  [/congelador|freezer/, "congelador"],
  [/estufa|hornilla/, "estufa"],
  [/horno/, "horno"],
  [/microondas/, "microondas"],
  [/lavavajillas|lavaplatos/, "lavavajillas"],
  [/licuadora/, "licuadora"],
  [/cafetera/, "cafetera"],
  [/freidora|air ?fryer/, "freidora"],
  [/aspiradora/, "aspiradora"],
  [/batidora/, "batidora"],
  [/tostadora|tostahorno/, "tostadora"],
  [/arrocera/, "arrocera"],
  [/olla/, "olla"],
  [/plancha/, "plancha"],
  [/sandwichera/, "sandwichera"],
  [/ventilador|abanico/, "ventilador"],
];

export function detectApplianceKind(title: string): string | null {
  const text = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  for (const [pattern, kind] of APPLIANCE_KINDS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

/** Cleans long marketplace titles into a comparable canonical product name. */
export function buildCanonicalName(title: string): string {
  const segments = title
    .split("|")
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return title.replace(/\s+/g, " ").trim();

  const picked: string[] = [];
  let length = 0;
  for (const segment of segments) {
    if (picked.length >= 3) break;
    picked.push(segment);
    length += segment.length;
    if (length >= 55) break;
  }

  return picked.join(" | ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word.length > 2 ? word[0]!.toUpperCase() + word.slice(1) : word.toUpperCase()))
    .join(" ");
}

/* -------------------------------------------------------------------------- */
/* Strict variant discriminators                                              */
/* -------------------------------------------------------------------------- */

interface VariantDiscriminators {
  sizeIn: number | null;
  panel: string | null;
  storage: string | null;
  ram: string | null;
  capacityKg: number | null;
  capacityCuFt: number | null;
  btu: number | null;
}

const PANEL_PATTERNS: Array<[RegExp, string]> = [
  [/neo\s?-?qled/i, "neo-qled"],
  [/qned/i, "qned"],
  [/mini\s?-?led/i, "miniled"],
  [/\boled\b/i, "oled"],
  [/\bqled\b/i, "qled"],
  [/nanocell/i, "nanocell"],
];

/**
 * Distinctive panel technology. Plain "LED" is deliberately ignored: it is the
 * default wording and stores drop it inconsistently, which would break legit
 * matches without protecting against anything.
 */
export function extractPanelTech(title: string): string | null {
  for (const [pattern, label] of PANEL_PATTERNS) {
    if (pattern.test(title)) return label;
  }
  return null;
}

interface MemoryProfile {
  ram: string | null;
  storage: string | null;
}

function normalizeGigabytes(value: string, unit: string): number {
  const amount = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(amount)) return 0;
  return Math.round(unit.toUpperCase() === "TB" ? amount * 1024 : amount);
}

/**
 * Extracts RAM/storage so "8GB RAM | 512GB SSD" and "8GB 512GB" produce the same
 * discriminators even when one store omits the words RAM/SSD.
 */
export function extractMemoryProfile(title: string): MemoryProfile {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let ramGb: number | null = null;
  let storageGb: number | null = null;

  const storageContext = normalized.match(
    /(?:SSD|HDD|NVME|EMMC|UFS|ALMACENAMIENTO|DISCO|STORAGE)\D{0,14}(\d{1,4})\s?(GB|TB)/i
  );
  if (storageContext?.[1] && storageContext[2]) {
    storageGb = normalizeGigabytes(storageContext[1], storageContext[2]);
  }

  // "512GB SSD" (number first, context after)
  const storageAfter = normalized.match(
    /(\d{1,4})\s?(GB|TB)\s?(?:DE\s)?(SSD|HDD|NVME|EMMC|UFS|ALMACENAMIENTO|DISCO)/i
  );
  if (storageAfter?.[1] && storageAfter[2] && storageGb === null) {
    storageGb = normalizeGigabytes(storageAfter[1], storageAfter[2]);
  }

  const ramAfter = normalized.match(/(\d{1,4})\s?(GB|TB)\s?(?:DE\s)?(?:RAM|DDR\d?|MEMORIA)/i);
  if (ramAfter?.[1] && ramAfter[2] && ramGb === null) {
    ramGb = normalizeGigabytes(ramAfter[1], ramAfter[2]);
  }

  if (ramGb === null || storageGb === null) {
    const bare = [...normalized.matchAll(/(\d{1,4})\s?(GB|TB)\b/gi)]
      .map((match) => normalizeGigabytes(match[1] ?? "0", match[2] ?? "GB"))
      .filter((value) => value > 0);
    const leftovers = bare.filter(
      (value) => value !== ramGb && value !== storageGb
    );
    if (leftovers.length >= 2) {
      const sorted = [...leftovers].sort((a, b) => a - b);
      if (ramGb === null) ramGb = sorted[0] ?? null;
      if (storageGb === null) storageGb = sorted[sorted.length - 1] ?? null;
    } else if (leftovers.length === 1) {
      const only = leftovers[0] ?? 0;
      // With RAM already identified ("8GB RAM"), the remaining value is storage.
      if (storageGb === null && (only >= 64 || ramGb !== null)) storageGb = only;
      else if (ramGb === null && only < 64) ramGb = only;
    }
  }

  return {
    ram: ramGb ? `${ramGb}gb` : null,
    storage: storageGb ? `${storageGb}gb` : null,
  };
}

function variantDiscriminators(title: string, category: ProductCategory): VariantDiscriminators {
  const memory = extractMemoryProfile(title);
  const screenIsVariant =
    category === "televisores" || /(monitor|proyector)/i.test(title);
  return {
    sizeIn: screenIsVariant ? extractScreenSizeInches(title) : null,
    panel: extractPanelTech(title),
    storage: memory.storage,
    ram: memory.ram,
    capacityKg: extractCapacityKg(title),
    capacityCuFt: extractCapacityCuFt(title),
    btu: extractBtu(title),
  };
}

function discriminatorSuffix(disc: VariantDiscriminators): string {
  const parts: string[] = [];
  if (disc.sizeIn) parts.push(`${disc.sizeIn}in`);
  if (disc.panel) parts.push(disc.panel);
  if (disc.storage) parts.push(disc.storage);
  if (disc.ram) parts.push(`ram${disc.ram}`);
  if (disc.capacityKg) parts.push(`${String(disc.capacityKg).replace(".", "-")}kg`);
  if (disc.capacityCuFt) parts.push(`${String(disc.capacityCuFt).replace(".", "-")}pc`);
  if (disc.btu) parts.push(`${disc.btu}btu`);
  return parts.join("-");
}

const SIGNATURE_STOPWORDS = new Set([
  "de", "la", "el", "en", "con", "para", "por", "y", "a", "un", "una", "del",
  "los", "las", "al", "o", "su", "sus", "mas", "más",
  "panama", "original", "nuevo", "nueva", "oferta", "promo", "promocion",
  "color", "negro", "blanco", "gris", "plata", "plateado", "azul", "rojo",
  "verde", "rosa", "dorado", "transparente", "smart", "tv", "pulgadas",
  "pulgada", "pulg", "nuevo", "incluye", "garantia", "anos", "año",
  // colors and commercial/telecom noise are not product identity
  ...COLOR_TOKENS,
  ...COMMERCIAL_NOISE,
]);

/**
 * Strict signature for products without a trustworthy model code. It keeps up
 * to 12 meaningful title tokens (series included: BRAVIA 8 vs BRAVIA 2) plus
 * every variant discriminator, so two different models can never collide on
 * brand + size alone.
 */
function strictSignature(
  title: string,
  brandSlug: string,
  disc: VariantDiscriminators,
  options: { hasBrand: boolean; storeSlug?: string }
): string {
  const noise = new Set([...UNIT_AND_SPEC_NOISE].map((token) => token.toLowerCase()));
  const tokens = slugify(title)
    .split("-")
    .filter(
      (token) =>
        (token.length >= 2 || /^\d+$/.test(token)) &&
        !SIGNATURE_STOPWORDS.has(token) &&
        !noise.has(token)
    )
    .slice(0, 12);

  const suffix = discriminatorSuffix(disc);
  const core = `${tokens.join("-")}${suffix ? `-${suffix}` : ""}`.replace(/-+/g, "-");
  const prefix = options.hasBrand
    ? brandSlug
    : `${brandSlug}-${slugify(options.storeSlug ?? "store")}`;
  return `${prefix}::${core}`.slice(0, 180);
}

function storageDiscriminator(title: string): string | null {
  return extractMemoryProfile(title).storage;
}

/**
 * Canonical iPhone key: `apple::iphone-<gen><tier>-<storage>`.
 * Tier strictly separates "" | e | air | plus | pro | pro-max, and storage is
 * mandatory, so `iPhone 17 512GB` matches across stores while `iPhone 17 Pro`
 * and `iPhone 17 256GB` never collide.
 */
export function canonicalIphoneKey(title: string): string | null {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const match = normalized.match(/\bIPHONE\s*(\d{1,2})\s*(PRO\s*MAX|PRO|PLUS|AIR|MINI|E)?\b/);
  if (!match?.[1]) return null;
  const storage = storageDiscriminator(title);
  if (!storage) return null;
  const generation = match[1];
  const tier = (match[2] ?? "").toLowerCase().replace(/\s+/g, "-");
  return `apple::iphone-${generation}${tier ? `-${tier}` : ""}-${storage}`;
}

/**
 * Canonical Samsung Galaxy S/A/Z key: `samsung::galaxy-<series><gen>-<tier>-<storage>`.
 * `Galaxy S25 FE 512GB` and `Galaxy S25 256GB` can never share a product.
 */
export function canonicalGalaxyKey(title: string): string | null {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  let series: string | null = null;
  let generation: string | null = null;
  let rawTier = "";

  const galaxy = normalized.match(
    /\bGALAXY\s+(?:Z\s+)?([SAZ])\s*(FE|PLUS|ULTRA|FLIP|FOLD|LITE)?\s*(\d{1,3})?\s*(FE|PLUS|ULTRA|FLIP|FOLD|LITE|\+)?/
  );
  if (galaxy?.[1]) {
    series = galaxy[1];
    generation = galaxy[3] ?? null;
    rawTier = galaxy[2] ?? galaxy[4] ?? "";
  } else {
    // Some stores write "Samsung A17 128GB" without the Galaxy word.
    const samsung = normalized.match(/\bSAMSUNG\s+([SAZ])(\d{1,3})\s*(FE|PLUS|ULTRA|LITE)?\b/);
    const phoneCues = /(5G|4G|GB|RAM|CELULAR|SMARTPHONE|DUAL\s?SIM)/.test(normalized);
    if (samsung?.[1] && phoneCues) {
      series = samsung[1];
      generation = samsung[2] ?? null;
      rawTier = samsung[3] ?? "";
    }
  }

  if (!series || !generation) return null;
  const storage = storageDiscriminator(title);
  if (!storage) return null;

  const tier = rawTier === "+" ? "plus" : rawTier.toLowerCase().replace(/[^a-z]/g, "");
  return `samsung::galaxy-${series.toLowerCase()}${generation}${tier ? `-${tier}` : ""}-${storage}`;
}

/**
 * Resolves brand/model/category and the strict multi-store match key for one item.
 *
 * Only an exact model code (plus every variant discriminator present in the
 * title) can produce a shared key. Brand + size / capacity alone never does:
 * a Sony BRAVIA 8 65" OLED ($1,499) and a BRAVIA 2 65" LED ($459) live in
 * different products and are surfaced as "alternativas similares" instead.
 */
export function deriveIdentity(input: IdentityInput): ParsedIdentity {
  const classified = classifyCategory(input.title, input.productType);
  // "Brazo articulado para TV de 32 a 90 pulgadas" is an accessory, not a TV.
  const category: ProductCategory =
    classified === "televisores" && /(soporte|brazo|base|mount|rack|mueble para tv)/i.test(input.title)
      ? "accesorios"
      : classified;
  const brand = extractPanamaBrand(input.title, input.vendor ?? null);
  const hinted = input.modelNumber?.trim();
  const modelNumber =
    hinted && looksLikeModelToken(hinted) ? normalizeToken(hinted) : extractTrustedModel(input);
  const brandSlug = slugify(brand ?? input.vendor ?? "generic") || "generic";

  const disc = variantDiscriminators(input.title, category);
  const gtin = normalizeGtin(input.gtin ?? null);
  const color = extractColor(input.title);

  const sharedMatchKey = buildMatchKey({
    title: input.title,
    brand,
    modelNumber,
  });

  const specs: Record<string, unknown> = {
    sourceStore: input.storeSlug ?? null,
    productType: input.productType ?? null,
    tags: input.tags?.slice(0, 12) ?? null,
    screenSizeInches: disc.sizeIn,
    panelTechnology: disc.panel,
    storage: disc.storage,
    ram: disc.ram,
    capacityKg: disc.capacityKg,
    capacityCuFt: disc.capacityCuFt,
    btu: disc.btu,
    color,
    gtin,
    sharedMatchKey,
  };

  const suffix = discriminatorSuffix(disc);
  let matchKey: string;
  let strategy: ParsedIdentity["strategy"];
  const iphoneKey = canonicalIphoneKey(input.title);
  const galaxyKey = canonicalGalaxyKey(input.title);

  if (gtin) {
    // A valid GTIN identifies the exact SKU across every store.
    matchKey = `gtin::${gtin}`;
    strategy = "gtin";
  } else if (iphoneKey) {
    matchKey = iphoneKey;
    strategy = "family";
  } else if (galaxyKey) {
    matchKey = galaxyKey;
    strategy = "family";
  } else if (modelNumber) {
    const modelSlug = slugify(modelNumber);
    matchKey = `${brandSlug}::${modelSlug}${suffix ? `-${suffix}` : ""}`.slice(0, 180);
    strategy = "model";
  } else {
    matchKey = strictSignature(input.title, brandSlug, disc, {
      hasBrand: Boolean(brand),
      storeSlug: input.storeSlug,
    });
    strategy = "signature";
  }

  specs.matchKeyStrategy = strategy;
  specs.discriminators = suffix || null;

  const isAccessory = ACCESSORY_HEAD.test(input.title.split("|")[0] ?? input.title);
  if (isAccessory) {
    matchKey = matchKey.startsWith(`${brandSlug}::`)
      ? `${brandSlug}::acc-${matchKey.slice(brandSlug.length + 2)}`
      : `acc-${matchKey}`;
    specs.isAccessory = true;
  }

  return {
    brand,
    modelNumber,
    category,
    matchKey,
    sharedMatchKey,
    canonicalName: buildCanonicalName(input.title),
    specs,
    strategy,
  };
}

export interface RelevanceInput {
  title: string;
  productType?: string | null;
  priceCents: number;
}

/**
 * Filters out the toys/clothing/home decor that Titán and Rodelag mix into
 * their electronics collections. We only keep products a price comparison site
 * for electronics and appliances should show.
 */
export function isRelevantElectronicsProduct(input: RelevanceInput): boolean {
  const { title, productType, priceCents } = input;
  if (!Number.isFinite(priceCents) || priceCents < 500 || priceCents > 3_000_000) return false;

  const haystack = `${title} ${productType ?? ""}`;
  if (NON_ELECTRONICS.test(haystack)) return false;

  const category = classifyCategory(title, productType);
  if (category !== "accesorios") return true;
  return ELECTRONICS_CUES.test(haystack) || ACCESSORY_CUES.test(haystack);
}

/** Deduplicates items by external id, keeping the cheapest in-stock variant. */
export function dedupeItems<T extends { externalId: string; priceCents: number; inStock: boolean }>(
  items: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    const current = byId.get(item.externalId);
    if (!current) {
      byId.set(item.externalId, item);
      continue;
    }
    const currentScore = (current.inStock ? 0 : 1_000_000) + current.priceCents;
    const nextScore = (item.inStock ? 0 : 1_000_000) + item.priceCents;
    if (nextScore < currentScore) byId.set(item.externalId, item);
  }
  return [...byId.values()];
}
