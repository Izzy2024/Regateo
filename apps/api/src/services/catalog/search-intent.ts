// ============================================================================
// Motor de intención, normalización, sinónimos (Panamá/LatAm), corrección de
// typos y clasificación Producto Principal vs Accesorio/Repuesto para búsqueda.
// ============================================================================
import {
  inArray,
  or,
  sql,
  products,
  storeListings,
} from "@regateo/db";
import type { ProductCategory } from "@regateo/shared";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------
export interface SearchMetaDTO {
  normalizedQuery: string;
  matchedVia: "exact" | "synonym" | "fuzzy";
  expandedTerms: string[];
}

export interface MatchPattern {
  type: "like" | "regex";
  pattern: string;
  /** Opcional: restringir este patrón a categorías específicas (ej. "portatil" solo en computadoras). */
  categories?: ProductCategory[];
}

export interface PrimaryDeviceSpec {
  /** Precio mínimo realista en centavos para el dispositivo principal (debajo = accesorio/repuesto/garantía). */
  minPriceCents: number;
  /** Categorías donde vive el producto principal. */
  preferredCategories: ProductCategory[];
  /** Regex Postgres (~*) sobre unaccent(lower(canonical_name)) que confirma producto principal. */
  positiveRegex: string;
  /** Regex Postgres (~*) de términos no-principales propios de este dispositivo (ej. portal, headset, smartwatch). */
  extraAccessoryRegex?: string;
  /** Si true (consolas como PS5/Xbox/Switch), prioriza consolas/bundles flagship en relevancia. */
  preferHigherTierInRelevance?: boolean;
  /** Regex que identifica al concepto tras "para ..." / "compatible con ..." / "repuesto de ...". */
  conceptNameRegex: string;
}

export interface SearchConcept {
  id: string;
  label: string;
  /** Frases o palabras normalizadas (sin acentos, minúsculas) que disparan el concepto. */
  triggers: string[];
  /** Término canónico usado para pg_trgm similarity (ej. "playstation 5", "televisor"). */
  canonicalTerm: string;
  /** Patrones SQL combinados con OR. */
  matchPatterns: MatchPattern[];
  /** Categorías que también cuentan como coincidencia del concepto (ej. `celulares` para "celular"). */
  matchCategories?: ProductCategory[];
  /** Configuración de producto principal vs accesorio (si es un dispositivo principal). */
  primaryDevice?: PrimaryDeviceSpec;
  /** Si true, el usuario explícitamente busca un accesorio/periférico (no penalizar accesorios). */
  isAccessoryConcept?: boolean;
}

export interface SearchPlan {
  rawQuery: string;
  normalizedQuery: string;
  /** Query optimizada para similarity() de pg_trgm (con términos canónicos expandidos). */
  similarityQuery: string;
  matchedVia: "exact" | "synonym";
  expandedTerms: string[];
  concepts: SearchConcept[];
  /** Tokens restantes no consumidos por conceptos (ya corregidos/stemmizados cuando aplica). */
  remainingTokens: Array<{
    raw: string;
    stem: string;
    altStems?: string[];
    useWordBoundary: boolean;
  }>;
  /** Tokens largos elegibles para fallback fuzzy pg_trgm. */
  fuzzyTokens: string[];
  /** True si hay al menos un token >= 4 chars que no cayó en ningún concepto conocido. */
  hasUnmappedLongToken: boolean;
  /** True si el query parece un SKU, código de modelo o identificador exacto (no usar fuzzy). */
  isCodeOrSku: boolean;
  /** True si el usuario explícitamente pidió un accesorio/repuesto/periférico/juego. */
  userWantsAccessory: boolean;
  /** Dispositivo principal activo (null si no aplica o si userWantsAccessory es true). */
  primaryDevice: PrimaryDeviceSpec | null;
}

// ---------------------------------------------------------------------------
// Diccionario de corrección de typos frecuentes (marcas y términos comunes)
// ---------------------------------------------------------------------------
const WORD_TYPO_MAP: Record<string, string> = {
  // Marcas
  sansung: "samsung",
  samsumg: "samsung",
  samsng: "samsung",
  samsug: "samsung",
  samsun: "samsung",
  aifon: "iphone",
  ifone: "iphone",
  iphne: "iphone",
  iphon: "iphone",
  pleystation: "playstation",
  playstacion: "playstation",
  playstasion: "playstation",
  playstaton: "playstation",
  xiami: "xiaomi",
  shaomi: "xiaomi",
  xiomi: "xiaomi",
  xaomi: "xiaomi",
  lenobo: "lenovo",
  lenvo: "lenovo",
  logitec: "logitech",
  logiteck: "logitech",
  hisence: "hisense",
  hicense: "hisense",
  panasoni: "panasonic",
  panasonik: "panasonic",
  wirpool: "whirlpool",
  whirpool: "whirlpool",
  wirlpool: "whirlpool",
  frigider: "frigidaire",
  frigidare: "frigidaire",
  motorla: "motorola",
  motrola: "motorola",
  huawai: "huawei",
  wawei: "huawei",
  huawey: "huawei",
  nintedo: "nintendo",
  ninteno: "nintendo",
  exbox: "xbox",
  swich: "switch",
  soni: "sony",
  filips: "philips",
  phillips: "philips",
  epsonn: "epson",
  karcher: "karcher",
  // Productos con typos frecuentes en español
  acondisionado: "acondicionado",
  acondiconado: "acondicionado",
  acondiciondo: "acondicionado",
  acondicionados: "acondicionados",
  acondisionados: "acondicionados",
  labadora: "lavadora",
  labadoras: "lavadoras",
  lavadra: "lavadora",
  telvisor: "televisor",
  televizor: "televisor",
  televizores: "televisores",
  televizon: "television",
  refrijeradora: "refrigeradora",
  refrijerador: "refrigerador",
  refrigeradra: "refrigeradora",
  audifnos: "audifonos",
  audifno: "audifono",
  auricualres: "auriculares",
  bentilador: "ventilador",
  bentiladores: "ventiladores",
  impresra: "impresora",
  microhondas: "microondas",
  microonda: "microondas",
  licudora: "licuadora",
  computadra: "computadora",
  portatiles: "portatiles",
  smarwatch: "smartwatch",
  smartwach: "smartwatch",
  blutooth: "bluetooth",
  bluetoth: "bluetooth",
  inalambrico: "inalambrico",
  inalambricos: "inalambricos",
};

// Conectores españoles que se omiten cuando hay otros tokens/conceptos con significado
const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "para",
  "por",
  "con",
  "sin",
  "en",
  "y",
  "o",
  "a",
  "al",
]);

// Palabras que no deben perder la "s" final al stemmizar
const NO_STEM_WORDS = new Set([
  "asus",
  "series",
  "windows",
  "wireless",
  "fitness",
  "express",
  "stylus",
  "nexus",
  "focus",
  "bonus",
  "status",
  "campus",
  "genius",
  "philips",
  "siemens",
  "hisense",
  "airpods",
  "earbuds",
  "beats",
  "watts",
  "volts",
  "hertz",
  "pixels",
  "megapixels",
  "bytes",
  "plus",
  "bus",
  "rms",
  "ips",
  "fps",
  "gps",
  "usb",
  "ios",
  "macos",
  "webos",
  "tizen",
  "dolby",
  "atmos",
  "astro",
  "hyperx",
  "targus",
  "mercusys",
  "dyson",
  "epson",
  "canon",
  "nikon",
  "garmin",
  "karcher",
  "oster",
  "ninja",
  "shark",
  "midea",
  "sankey",
  "nisato",
  "selectron",
  "premier",
  "klip",
  "xtech",
  "argom",
  "forza",
  "avtek",
  "maxell",
  "belkin",
  "ugreen",
  "anker",
  "sandisk",
  "kingston",
  "crucial",
  "seagate",
  "razer",
  "corsair",
  "logitech",
  "lenovo",
  "samsung",
  "xiaomi",
  "huawei",
  "motorola",
  "nintendo",
  "playstation",
  "xbox",
  "switch",
  "smart",
  "ultra",
  "slim",
  "mini",
  "lite",
  "bluetooth",
  "inverter",
  "split",
  "gaming",
  "gamer",
  "bench",
  "aires",
  "microondas",
  "parlantes",
  "audifonos",
  "auriculares",
  "televisores",
]);

// Palabras que indican que el usuario EXPLÍCITAMENTE quiere un accesorio, repuesto,
// periférico, consumible, garantía o videojuego.
const ACCESSORY_INTENT_WORDS = new Set([
  "control",
  "controles",
  "controlador",
  "mando",
  "mandos",
  "gamepad",
  "volante",
  "volantes",
  "joystick",
  "palanca",
  "dualsense",
  "dualshock",
  "audifono",
  "audifonos",
  "auricular",
  "auriculares",
  "headset",
  "headsets",
  "headphone",
  "headphones",
  "casco",
  "cascos",
  "earbud",
  "earbuds",
  "airpod",
  "airpods",
  "cable",
  "cables",
  "adaptador",
  "adaptadores",
  "cargador",
  "cargadores",
  "charger",
  "powerbank",
  "funda",
  "fundas",
  "estuche",
  "estuches",
  "case",
  "cover",
  "forro",
  "forros",
  "protector",
  "protectores",
  "soporte",
  "soportes",
  "base",
  "bases",
  "brazo",
  "brazos",
  "rack",
  "racks",
  "filtro",
  "filtros",
  "manguera",
  "mangueras",
  "tuerca",
  "tuercas",
  "repuesto",
  "repuestos",
  "pieza",
  "piezas",
  "valvula",
  "valvulas",
  "tubo",
  "tubos",
  "tuberia",
  "boquilla",
  "boquillas",
  "conector",
  "conectores",
  "antena",
  "antenas",
  "convertidor",
  "convertidores",
  "splitter",
  "conmutador",
  "regleta",
  "regletas",
  "mochila",
  "mochilas",
  "bolso",
  "bolsos",
  "maletin",
  "maletines",
  "vidrio",
  "mica",
  "micas",
  "lamina",
  "laminas",
  "limpiador",
  "espuma",
  "kit",
  "accesorio",
  "accesorios",
  "porta",
  "ssd",
  "nvme",
  "hdd",
  "memoria",
  "memorias",
  "disco",
  "juego",
  "juegos",
  "videojuego",
  "videojuegos",
  "tinta",
  "tintas",
  "toner",
  "cartucho",
  "cartuchos",
  "cinta",
  "cintas",
  "papel",
  "resma",
  "bateria",
  "baterias",
  "portal",
  "mousepad",
  "teclado",
  "teclados",
  "keyboard",
  "mouse",
  "raton",
  "microfono",
  "microfonos",
  "webcam",
  "candado",
  "tarjetero",
  "organizador",
  "deodorizador",
  "garantia",
  "correa",
  "pulsera",
  "tripode",
  "tapa",
  "tapas",
  "gatillo",
  "gatillos",
  "hub",
  "dock",
  "stylus",
  "lapiz",
  "pencil",
]);

const ACCESSORY_INTENT_PHRASES = [
  "remote player",
  "disco duro",
  "disco solido",
  "estado solido",
  "garantia extendida",
  "protector de voltaje",
  "protector voltaje",
  "control remoto",
  "soporte de pared",
  "filtro de agua",
  "botella de tinta",
  "vidrio templado",
  "power bank",
];

// Palabras que impiden que la palabra suelta "aire" dispare aire acondicionado
const NON_AC_AIR_CONTEXT = new Set([
  "freidora",
  "freidoras",
  "fryer",
  "purificador",
  "enfriador",
  "colchon",
  "bomba",
  "soplador",
  "compresor",
  "humidificador",
  "deshumidificador",
  "pistola",
  "llave",
]);

// ---------------------------------------------------------------------------
// Catálogo de conceptos (Panamá / LatAm)
// ---------------------------------------------------------------------------
const CONCEPTS: SearchConcept[] = [
  // ---- Frases multi-palabra primero (evita que "freidora de aire" dispare "aire") ----
  {
    id: "freidora-aire",
    label: "Freidora de Aire / Air Fryer",
    canonicalTerm: "freidora de aire",
    triggers: [
      "freidora de aire",
      "freidoras de aire",
      "air fryer",
      "airfryer",
      "air frier",
      "freidora",
      "freidoras",
    ],
    matchPatterns: [
      { type: "like", pattern: "%freidora%" },
      { type: "regex", pattern: "air\\s*fryer" },
    ],
    primaryDevice: {
      minPriceCents: 2500,
      preferredCategories: ["electrodomesticos"],
      positiveRegex: "(freidora|air\\s*fryer)",
      extraAccessoryRegex: "(molde|papel\\s+pergamino|rejilla\\s+de\\s+repuesto|canasta\\s+de\\s+repuesto)",
      conceptNameRegex: "(freidora|air\\s*fryer)",
    },
  },
  {
    id: "secadora-cabello",
    label: "Secadora de Cabello",
    canonicalTerm: "secadora de cabello",
    triggers: [
      "secadora de cabello",
      "secadora de pelo",
      "secador de cabello",
      "secador de pelo",
    ],
    matchPatterns: [
      { type: "regex", pattern: "secador[a]?\\s+de\\s+(cabello|pelo)" },
    ],
  },
  {
    id: "barra-sonido",
    label: "Barra de Sonido / Soundbar",
    canonicalTerm: "barra de sonido",
    triggers: [
      "barra de sonido",
      "barras de sonido",
      "soundbar",
      "sound bar",
    ],
    matchPatterns: [
      { type: "like", pattern: "%barra de sonido%" },
      { type: "regex", pattern: "sound\\s*bar" },
    ],
    primaryDevice: {
      minPriceCents: 3500,
      preferredCategories: ["audio"],
      positiveRegex: "(barra\\s+de\\s+sonido|sound\\s*bar)",
      conceptNameRegex: "(barra\\s+de\\s+sonido|sound\\s*bar)",
    },
  },
  {
    id: "centro-lavado",
    label: "Centro de Lavado / Lavaseca",
    canonicalTerm: "centro de lavado",
    triggers: [
      "centro de lavado",
      "torre de lavado",
      "lavadora secadora",
      "lavaseca",
      "lava seca",
    ],
    matchPatterns: [
      { type: "like", pattern: "%centro de lavado%" },
      { type: "like", pattern: "%torre de lavado%" },
      { type: "like", pattern: "%lavaseca%" },
      { type: "regex", pattern: "lavadora.*secadora" },
    ],
    primaryDevice: {
      minPriceCents: 35000,
      preferredCategories: ["linea-blanca"],
      positiveRegex: "(centro\\s+de\\s+lavado|torre\\s+de\\s+lavado|lavaseca|lavadora.*secadora)",
      conceptNameRegex: "(centro\\s+de\\s+lavado|lavaseca)",
    },
  },
  {
    id: "aire-acondicionado",
    label: "Aire Acondicionado",
    canonicalTerm: "aire acondicionado",
    triggers: [
      "aire acondicionado",
      "aires acondicionados",
      "aire acond",
      "mini split",
      "minisplit",
      "a/c",
      "aire",
      "clima",
    ],
    matchPatterns: [
      { type: "like", pattern: "%aire acondicionado%" },
      { type: "regex", pattern: "mini\\s*split" },
      { type: "regex", pattern: "\\msplit\\M.*btu" },
      { type: "regex", pattern: "inverter.*btu" },
    ],
    primaryDevice: {
      minPriceCents: 10000,
      preferredCategories: ["aires-acondicionados"],
      positiveRegex: "(aire\\s+acondicionado|mini\\s*split|\\msplit\\M|btu|inverter)",
      extraAccessoryRegex: "(controlador|sensibo)",
      conceptNameRegex: "(aire\\s+acondicionado|compresor\\s+de\\s+aire|mini\\s*split|\\msplit\\M)",
    },
  },

  // ---- Consolas ----
  {
    id: "ps5",
    label: "PlayStation 5",
    canonicalTerm: "consola playstation 5",
    triggers: [
      "playstation 5",
      "playstation5",
      "play station 5",
      "play 5",
      "play5",
      "ps 5",
      "ps5",
      "pc 5",
      "pc5",
    ],
    matchPatterns: [
      // unaccent('®') en Postgres produce '(R)' y '™' produce 'TM'
      { type: "regex", pattern: "playstation(\\s*(\\(r\\)|tm|®|™))?\\s*5" },
      { type: "regex", pattern: "play\\s+station(\\s*(\\(r\\)|tm|®|™))?\\s*5" },
      { type: "regex", pattern: "\\mps5\\M" },
    ],
    primaryDevice: {
      minPriceCents: 30000,
      preferredCategories: ["gaming"],
      positiveRegex: "(consola|bundle|slim|digital|estandar|825\\s*gb|1\\s*tb)",
      extraAccessoryRegex:
        "(portal|remote\\s*player|auricular|audifono|headset|gamepad|volante|palanca|unidad\\s+de\\s+estado|\\mssd\\M|dualsense|videojuego|tapas|abanico|ventilador|paquete\\s+completo)",
      preferHigherTierInRelevance: true,
      conceptNameRegex: "(playstation(\\s*(\\(r\\)|tm|®|™))?\\s*5|playstation|\\mps5\\M)",
    },
  },
  {
    id: "ps4",
    label: "PlayStation 4",
    canonicalTerm: "consola playstation 4",
    triggers: [
      "playstation 4",
      "playstation4",
      "play station 4",
      "play 4",
      "play4",
      "ps 4",
      "ps4",
    ],
    matchPatterns: [
      { type: "regex", pattern: "playstation(\\s*(\\(r\\)|tm|®|™))?\\s*4" },
      { type: "regex", pattern: "play\\s+station(\\s*(\\(r\\)|tm|®|™))?\\s*4" },
      { type: "regex", pattern: "\\mps4\\M" },
    ],
    primaryDevice: {
      minPriceCents: 15000,
      preferredCategories: ["gaming"],
      positiveRegex: "(consola|bundle|slim|pro|500\\s*gb|1\\s*tb)",
      extraAccessoryRegex:
        "(auricular|audifono|headset|gamepad|volante|palanca|videojuego|paquete\\s+completo|mando|dualshock)",
      preferHigherTierInRelevance: true,
      conceptNameRegex: "(playstation(\\s*(\\(r\\)|tm|®|™))?\\s*4|playstation|\\mps4\\M)",
    },
  },
  {
    id: "playstation",
    label: "PlayStation",
    canonicalTerm: "consola playstation",
    triggers: ["playstation", "play station"],
    matchPatterns: [
      { type: "like", pattern: "%playstation%" },
      { type: "regex", pattern: "play\\s+station" },
      { type: "regex", pattern: "\\mps[45]\\M" },
    ],
    primaryDevice: {
      minPriceCents: 25000,
      preferredCategories: ["gaming"],
      positiveRegex: "(consola|bundle|slim|digital|estandar)",
      extraAccessoryRegex:
        "(portal|remote\\s*player|auricular|audifono|headset|gamepad|volante|palanca|unidad\\s+de\\s+estado|\\mssd\\M|dualsense|videojuego|tapas|abanico)",
      preferHigherTierInRelevance: true,
      conceptNameRegex: "(playstation|\\mps[45]\\M)",
    },
  },
  {
    id: "xbox",
    label: "Xbox",
    canonicalTerm: "consola xbox",
    triggers: ["xbox"],
    matchPatterns: [{ type: "like", pattern: "%xbox%" }],
    primaryDevice: {
      minPriceCents: 18000,
      preferredCategories: ["gaming"],
      positiveRegex: "(consola|series\\s*[xs]|512\\s*gb|1\\s*tb)",
      extraAccessoryRegex:
        "(auricular|audifono|headset|gamepad|volante|palanca|videojuego|paquete\\s+completo)",
      preferHigherTierInRelevance: true,
      conceptNameRegex: "(xbox)",
    },
  },
  {
    id: "nintendo-switch",
    label: "Nintendo Switch",
    canonicalTerm: "consola nintendo switch",
    triggers: ["nintendo switch", "nintendo"],
    matchPatterns: [
      { type: "like", pattern: "%nintendo%" },
      { type: "regex", pattern: "\\mswitch\\M.*(oled|lite|consola|joy)" },
    ],
    primaryDevice: {
      minPriceCents: 15000,
      preferredCategories: ["gaming"],
      positiveRegex: "(consola|oled|lite|switch\\s*2|bundle)",
      extraAccessoryRegex:
        "(auricular|audifono|headset|gamepad|videojuego|estuche|funda|protector|mica|vidrio)",
      preferHigherTierInRelevance: true,
      conceptNameRegex: "(nintendo|switch)",
    },
  },

  // ---- Televisores ----
  {
    id: "televisor",
    label: "Televisor / Smart TV",
    canonicalTerm: "televisor smart tv",
    triggers: [
      "smart tv",
      "smarttv",
      "televisor",
      "televisores",
      "television",
      "tele",
      "tv",
      "tvs",
    ],
    matchPatterns: [
      { type: "like", pattern: "%televisor%" },
      { type: "like", pattern: "%television%" },
      { type: "regex", pattern: "smart\\s*tv" },
      { type: "regex", pattern: "\\mtv\\M" },
    ],
    primaryDevice: {
      minPriceCents: 8000,
      preferredCategories: ["televisores"],
      positiveRegex:
        "(televisor|smart\\s*tv|\\mtv\\M|\\m(uhd|qled|oled|nanocell|4k|fhd|hd|led|google\\s*tv|webos|tizen)\\M|\\d{2}\\s*(\"|pulg))",
      extraAccessoryRegex:
        "(antena|convertidor|splitter|conmutador|chromecast|fire\\s*tv|roku|tv\\s*box|android\\s*tv\\s*box|streamer|barra\\s+de\\s+sonido|soundbar|mueble|rack)",
      conceptNameRegex: "(televisor|television|\\mtv\\M|smart\\s*tv|pantalla)",
    },
  },

  // ---- Línea blanca ----
  {
    id: "refrigeradora",
    label: "Refrigeradora / Nevera",
    canonicalTerm: "refrigeradora",
    triggers: [
      "refrigeradora",
      "refrigeradoras",
      "refrigerador",
      "refrigeradores",
      "nevera",
      "neveras",
      "refri",
      "refris",
      "heladera",
      "frigorifico",
    ],
    matchPatterns: [
      { type: "like", pattern: "%refrigeradora%" },
      { type: "like", pattern: "%refrigerador%" },
      { type: "like", pattern: "%nevera%" },
      { type: "regex", pattern: "\\mrefri\\M" },
      { type: "like", pattern: "%frigorifico%" },
    ],
    primaryDevice: {
      minPriceCents: 12000,
      preferredCategories: ["linea-blanca"],
      positiveRegex:
        "(refrigeradora|refrigerador|nevera|inverter|side\\s*by\\s*side|french\\s*door|top\\s*mount|pies\\s*cub|cu\\.?\\s*ft)",
      extraAccessoryRegex:
        "(lip\\s*gloss|organizador|deodorizador|filtro\\s+de\\s+agua|dispensador\\s+de\\s+agua)",
      conceptNameRegex: "(refrigeradora|refrigerador|nevera|\\mrefri\\M)",
    },
  },
  {
    id: "lavadora",
    label: "Lavadora",
    canonicalTerm: "lavadora",
    triggers: [
      "lavadora",
      "lavadoras",
      "lavarropa",
      "lavarropas",
    ],
    matchPatterns: [
      // Word boundary \m evita coincidir con "hidrolavadora"
      { type: "regex", pattern: "\\mlavadora" },
      { type: "like", pattern: "%lavarropa%" },
      { type: "like", pattern: "%centro de lavado%" },
      { type: "like", pattern: "%lavaseca%" },
    ],
    primaryDevice: {
      minPriceCents: 15000,
      preferredCategories: ["linea-blanca"],
      positiveRegex:
        "(\\mlavadora|centro\\s+de\\s+lavado|lavaseca|\\d+\\s*(kg|lb)|carga\\s+(frontal|superior)|automatica|doble\\s+tina)",
      extraAccessoryRegex:
        "(hidrolavadora|manguera|forro|funda|conector|valvula|tubo|base\\s+metalica|kit\\s+de\\s+apilamiento|toys)",
      conceptNameRegex: "(lavadora|lavadoras|lavarropa|hidrolavadora)",
    },
  },
  {
    id: "secadora",
    label: "Secadora",
    canonicalTerm: "secadora",
    triggers: ["secadora", "secadoras", "secador de ropa"],
    matchPatterns: [{ type: "like", pattern: "%secadora%" }],
    primaryDevice: {
      minPriceCents: 15000,
      preferredCategories: ["linea-blanca"],
      positiveRegex: "(secadora|centro\\s+de\\s+lavado|lavaseca|\\d+\\s*(kg|lb))",
      extraAccessoryRegex: "(cabello|pelo|kit\\s+de\\s+apilamiento|manguera|ducto)",
      conceptNameRegex: "(secadora|secadoras)",
    },
  },
  {
    id: "estufa",
    label: "Estufa / Cocina",
    canonicalTerm: "estufa",
    triggers: [
      "estufa",
      "estufas",
      "cocina a gas",
      "cocina de gas",
      "cocina electrica",
    ],
    matchPatterns: [
      { type: "like", pattern: "%estufa%" },
      { type: "regex", pattern: "cocina\\s+(a\\s+gas|de\\s+gas|electrica|induccion)" },
    ],
    primaryDevice: {
      minPriceCents: 5000,
      preferredCategories: ["linea-blanca", "electrodomesticos"],
      positiveRegex: "(estufa|quemador|horno|induccion|vitroceramica)",
      extraAccessoryRegex: "(manguera|regulador|valvula|perilla|encendedor)",
      conceptNameRegex: "(estufa|estufas|cocina)",
    },
  },
  {
    id: "abanico",
    label: "Abanico / Ventilador",
    canonicalTerm: "abanico ventilador",
    triggers: ["abanico", "abanicos", "ventilador", "ventiladores"],
    matchPatterns: [
      { type: "like", pattern: "%abanico%" },
      { type: "like", pattern: "%ventilador%" },
    ],
    primaryDevice: {
      minPriceCents: 1200,
      preferredCategories: ["electrodomesticos", "linea-blanca", "aires-acondicionados"],
      positiveRegex: "(abanico|ventilador)",
      extraAccessoryRegex:
        "(para\\s+ps5|para\\s+laptop|enfriador\\s+para\\s+laptop|cooling\\s+pad|disipador|\\mcpu\\M|case\\s+fan)",
      conceptNameRegex: "(abanico|ventilador)",
    },
  },

  // ---- Celulares, Tablets, Computadoras ----
  {
    id: "iphone",
    label: "iPhone",
    canonicalTerm: "iphone",
    triggers: ["iphone", "i phone"],
    matchPatterns: [{ type: "like", pattern: "%iphone%" }],
    primaryDevice: {
      minPriceCents: 15000,
      preferredCategories: ["celulares"],
      positiveRegex: "(iphone\\s*(1[1-7]|se|pro|plus|max|air|mini)|\\d{2,3}\\s*gb|\\d\\s*tb)",
      extraAccessoryRegex:
        "(funda|cover|case|cargador|cable|adaptador|soporte|protector|vidrio|mica|tarjetero)",
      conceptNameRegex: "(iphone)",
    },
  },
  {
    id: "celular",
    label: "Celular / Smartphone",
    canonicalTerm: "celular smartphone",
    triggers: [
      "telefono celular",
      "telefono inteligente",
      "celular",
      "celulares",
      "smartphone",
      "smartphones",
      "telefono",
      "telefonos",
      "movil",
      "moviles",
      "cel",
    ],
    matchPatterns: [
      { type: "like", pattern: "%celular%" },
      { type: "like", pattern: "%smartphone%" },
      { type: "like", pattern: "%telefono%" },
      { type: "like", pattern: "%iphone%" },
      { type: "regex", pattern: "galaxy\\s+(s|a|z|m|note)\\d" },
      { type: "like", pattern: "%redmi%" },
      { type: "like", pattern: "%poco %" },
      { type: "like", pattern: "%moto g%" },
      { type: "like", pattern: "%moto e%" },
      { type: "like", pattern: "%honor %" },
      { type: "like", pattern: "%tecno %" },
      { type: "like", pattern: "%infinix%" },
    ],
    matchCategories: ["celulares"],
    primaryDevice: {
      minPriceCents: 6000,
      preferredCategories: ["celulares"],
      positiveRegex:
        "(celular|smartphone|iphone|galaxy\\s+(s|a|z|m)|redmi|poco|moto\\s+[ge]|honor|tecno|infinix|xiaomi|pixel|\\d{2,3}\\s*gb)",
      extraAccessoryRegex:
        "(reloj\\s+inteligente|smartwatch|banda\\s+\\d|router|disipador|tablet|tableta|ipad|panadol|refractario|porta\\s+celular|tarjetero|disparador|selfie|tripode|aro\\s+de\\s+luz|telefono\\s+ip|\\mvoip\\M|\\msip\\M|telefono\\s+fijo|telefono\\s+inalambrico)",
      conceptNameRegex: "(celular|celulares|smartphone|telefono|iphone|movil)",
    },
  },
  {
    id: "laptop",
    label: "Laptop / Portátil",
    canonicalTerm: "laptop",
    triggers: [
      "computadora portatil",
      "ordenador portatil",
      "laptop",
      "laptops",
      "portatil",
      "portatiles",
      "notebook",
      "notebooks",
      "macbook",
      "ultrabook",
      "chromebook",
      "computadora",
      "computadoras",
      "compu",
      "compus",
    ],
    matchPatterns: [
      { type: "like", pattern: "%laptop%" },
      { type: "like", pattern: "%notebook%" },
      { type: "like", pattern: "%macbook%" },
      { type: "like", pattern: "%chromebook%" },
      { type: "like", pattern: "%ultrabook%" },
      { type: "like", pattern: "%computadora%" },
      // Evita que "portatil" capture "Bocina Portátil" o "Radio Portátil"
      { type: "like", pattern: "%portatil%", categories: ["computadoras"] },
    ],
    primaryDevice: {
      minPriceCents: 15000,
      preferredCategories: ["computadoras"],
      positiveRegex:
        "(laptop|notebook|macbook|chromebook|ultrabook|portatil|computadora|all\\s*in\\s*one|intel\\s+core|ryzen|celeron|\\mm[1-4]\\M|ram|\\d+\\s*gb)",
      extraAccessoryRegex:
        "(bocina|parlante|radio|mochila|maletin|bolso|funda|sleeve|candado|seguridad|base\\s+enfriadora|cooling|dock|hub|adaptador|cable|cargador|teclado|mouse|monitor|impresora|soporte|microfono|lavalier|transmisor|receptor|dji\\s+mic|webcam|camara|router|\\mswitch\\M|\\mups\\M|regulador|proyector|escaner|tablet)",
      conceptNameRegex: "(laptop|laptops|portatil|portatiles|notebook|macbook|computadora|\\mpc\\M)",
    },
  },
  {
    id: "tablet",
    label: "Tablet / iPad",
    canonicalTerm: "tablet ipad",
    triggers: ["tablet", "tablets", "tableta", "tabletas", "ipad", "ipads"],
    matchPatterns: [
      { type: "like", pattern: "%tablet%" },
      { type: "like", pattern: "%ipad%" },
    ],
    primaryDevice: {
      minPriceCents: 5000,
      preferredCategories: ["celulares", "computadoras"],
      positiveRegex: "(tablet|ipad|galaxy\\s+tab|fire\\s+hd|\\d{2,3}\\s*gb)",
      extraAccessoryRegex:
        "(panadol|refractario|tabletops|funda|cover|case|teclado|lapiz|stylus|pencil|protector|vidrio|mica|soporte|cargador|cable)",
      conceptNameRegex: "(tablet|tablets|tableta|tabletas|ipad)",
    },
  },
  {
    id: "monitor",
    label: "Monitor",
    canonicalTerm: "monitor",
    triggers: ["monitor", "monitores"],
    matchPatterns: [{ type: "like", pattern: "%monitor%" }],
    primaryDevice: {
      minPriceCents: 6000,
      preferredCategories: ["computadoras", "perifericos", "gaming"],
      positiveRegex: "(monitor|hz|\\mips\\M|\\mva\\M|oled|fhd|qhd|4k|pulg|\")",
      extraAccessoryRegex:
        "(brazo|soporte|base|cable|adaptador|protector|limpiador|monitor\\s+de\\s+(bebe|presion|glucosa))",
      conceptNameRegex: "(monitor|monitores)",
    },
  },
  {
    id: "impresora",
    label: "Impresora / Multifuncional",
    canonicalTerm: "impresora multifuncional",
    triggers: [
      "impresora",
      "impresoras",
      "printer",
      "printers",
      "multifuncional",
      "multifuncionales",
    ],
    matchPatterns: [
      { type: "like", pattern: "%impresora%" },
      { type: "like", pattern: "%printer%" },
      {
        type: "regex",
        pattern:
          "(multifuncional.*(impres|escan|copiad|wifi|tinta|laser|ecotank|hp|epson|canon|brother)|(impresora|hp|epson|canon|brother).*multifuncional)",
      },
    ],
    primaryDevice: {
      minPriceCents: 4000,
      // En los datos reales de Panamá las impresoras viven mayormente en `accesorios`
      preferredCategories: ["accesorios", "computadoras", "perifericos"],
      positiveRegex:
        "(impresora|ecotank|deskjet|laserjet|smart\\s+tank|pixma)",
      extraAccessoryRegex:
        "(tinta|toner|cartucho|botella\\s+de\\s+tinta|cintas?\\s+de\\s+impresion|papel|resma|etiqueta|rollo|cable|cabezal|olla|multicoccion|gadget|lampara|bocina|cuchilla|herramienta|batidora|licuadora|freidora)",
      conceptNameRegex: "(impresora|impresoras|printer|multifuncional)",
    },
  },

  // ---- Electrodomésticos ----
  {
    id: "microondas",
    label: "Microondas",
    canonicalTerm: "microondas",
    triggers: ["horno microondas", "microondas", "microonda", "microwave"],
    matchPatterns: [
      { type: "like", pattern: "%microonda%" },
      { type: "like", pattern: "%microwave%" },
    ],
    primaryDevice: {
      minPriceCents: 4000,
      preferredCategories: ["electrodomesticos", "linea-blanca"],
      positiveRegex: "(microonda|microwave|pies\\s*cub|cu\\.?\\s*ft|\\d+\\s*w\\M)",
      extraAccessoryRegex: "(plato\\s+giratorio|tapa|cover|soporte|repisa|envase|recipiente)",
      conceptNameRegex: "(microondas|microonda)",
    },
  },
  {
    id: "licuadora",
    label: "Licuadora",
    canonicalTerm: "licuadora",
    triggers: ["licuadora", "licuadoras", "blender"],
    matchPatterns: [
      { type: "like", pattern: "%licuadora%" },
      { type: "like", pattern: "%blender%" },
    ],
    primaryDevice: {
      minPriceCents: 1500,
      preferredCategories: ["electrodomesticos"],
      positiveRegex: "(licuadora|blender|velocidad|watts|\\d+\\s*w\\M)",
      extraAccessoryRegex: "(vaso\\s+de\\s+repuesto|cuchilla|empaque|tapa|repuesto|acople)",
      conceptNameRegex: "(licuadora|blender)",
    },
  },
  {
    id: "aspiradora",
    label: "Aspiradora",
    canonicalTerm: "aspiradora",
    triggers: ["aspiradora", "aspiradoras", "vacuum"],
    matchPatterns: [
      { type: "like", pattern: "%aspiradora%" },
      { type: "like", pattern: "%vacuum%" },
    ],
    primaryDevice: {
      minPriceCents: 2500,
      preferredCategories: ["electrodomesticos", "linea-blanca"],
      positiveRegex: "(aspiradora|vacuum|robot)",
      extraAccessoryRegex: "(bolsa|filtro|cepillo\\s+de\\s+repuesto|repuesto|manguera|boquilla)",
      conceptNameRegex: "(aspiradora|vacuum)",
    },
  },
  {
    id: "cafetera",
    label: "Cafetera",
    canonicalTerm: "cafetera",
    triggers: ["cafetera", "cafeteras", "coffee maker", "espresso"],
    matchPatterns: [
      { type: "like", pattern: "%cafetera%" },
      { type: "like", pattern: "%coffee maker%" },
      { type: "like", pattern: "%espresso%" },
    ],
    primaryDevice: {
      minPriceCents: 1500,
      preferredCategories: ["electrodomesticos"],
      positiveRegex: "(cafetera|coffee\\s*maker|espresso|tazas)",
      extraAccessoryRegex: "(filtro|capsula|jarra\\s+de\\s+repuesto|repuesto|descalcificador)",
      conceptNameRegex: "(cafetera)",
    },
  },
  {
    id: "plancha",
    label: "Plancha",
    canonicalTerm: "plancha",
    triggers: ["plancha", "planchas"],
    matchPatterns: [{ type: "like", pattern: "%plancha%" }],
  },

  // ---- Audio, Wearables, Cámaras ----
  {
    id: "bocina",
    label: "Bocina / Parlante",
    canonicalTerm: "bocina parlante",
    triggers: [
      "bocina",
      "bocinas",
      "parlante",
      "parlantes",
      "corneta",
      "cornetas",
      "altavoz",
      "altavoces",
      "speaker",
      "speakers",
    ],
    matchPatterns: [
      { type: "like", pattern: "%bocina%" },
      { type: "like", pattern: "%parlante%" },
      { type: "like", pattern: "%altavoz%" },
      { type: "like", pattern: "%speaker%" },
      { type: "like", pattern: "%corneta%" },
    ],
    primaryDevice: {
      minPriceCents: 1000,
      preferredCategories: ["audio"],
      positiveRegex: "(bocina|parlante|altavoz|speaker|partybox|soundbar|barra\\s+de\\s+sonido)",
      extraAccessoryRegex: "(microfono|tripode|pedestal|soporte|funda|estuche|cable|cargador|monitor)",
      conceptNameRegex: "(bocina|bocinas|parlante|parlantes|altavoz|speaker)",
    },
  },
  {
    id: "smartwatch",
    label: "Smartwatch / Reloj Inteligente",
    canonicalTerm: "smartwatch reloj inteligente",
    triggers: [
      "reloj inteligente",
      "relojes inteligentes",
      "smartwatch",
      "smart watch",
      "apple watch",
      "galaxy watch",
    ],
    matchPatterns: [
      { type: "regex", pattern: "smart\\s*watch" },
      { type: "like", pattern: "%reloj inteligente%" },
      { type: "like", pattern: "%apple watch%" },
      { type: "like", pattern: "%galaxy watch%" },
    ],
    primaryDevice: {
      minPriceCents: 1500,
      preferredCategories: ["celulares", "televisores"],
      positiveRegex: "(smart\\s*watch|reloj\\s+inteligente|apple\\s+watch|galaxy\\s+watch)",
      extraAccessoryRegex: "(correa|pulsera|cargador|cable|protector|mica|vidrio|funda|case)",
      conceptNameRegex: "(smart\\s*watch|reloj\\s+inteligente|apple\\s+watch|galaxy\\s+watch)",
    },
  },
  {
    id: "camara",
    label: "Cámara",
    canonicalTerm: "camara",
    triggers: ["camara web", "camara", "camaras", "camera", "cameras", "webcam"],
    matchPatterns: [
      { type: "like", pattern: "%camara%" },
      { type: "like", pattern: "%camera%" },
      { type: "like", pattern: "%webcam%" },
    ],
  },

  // ---- Periféricos y Accesorios (el usuario los pide explícitamente) ----
  {
    id: "audifonos",
    label: "Audífonos / Auriculares",
    canonicalTerm: "audifonos auriculares",
    isAccessoryConcept: true,
    triggers: [
      "audifonos",
      "audifono",
      "auriculares",
      "auricular",
      "headset",
      "headsets",
      "headphones",
      "headphone",
      "cascos",
      "earbuds",
      "earbud",
      "airpods",
      "airpod",
    ],
    matchPatterns: [
      { type: "like", pattern: "%audifono%" },
      { type: "like", pattern: "%auricular%" },
      { type: "like", pattern: "%headset%" },
      { type: "like", pattern: "%headphone%" },
      { type: "like", pattern: "%earbud%" },
      { type: "like", pattern: "%airpod%" },
      { type: "like", pattern: "%in-ear%" },
      { type: "like", pattern: "%over-ear%" },
    ],
  },
  {
    id: "mouse",
    label: "Mouse / Ratón",
    canonicalTerm: "mouse",
    isAccessoryConcept: true,
    triggers: ["mouse", "raton", "ratones"],
    matchPatterns: [
      // \mmouse\M evita coincidir con mousepad
      { type: "regex", pattern: "\\mmouse\\M" },
      { type: "like", pattern: "%raton%" },
    ],
  },
  {
    id: "teclado",
    label: "Teclado / Keyboard",
    canonicalTerm: "teclado",
    isAccessoryConcept: true,
    triggers: ["teclado", "teclados", "keyboard", "keyboards"],
    matchPatterns: [
      { type: "like", pattern: "%teclado%" },
      { type: "like", pattern: "%keyboard%" },
    ],
  },
  {
    id: "control",
    label: "Control / Mando",
    canonicalTerm: "control mando",
    isAccessoryConcept: true,
    triggers: [
      "control",
      "controles",
      "mando",
      "mandos",
      "gamepad",
      "joystick",
      "dualsense",
      "dualshock",
    ],
    matchPatterns: [
      { type: "like", pattern: "%control%" },
      { type: "like", pattern: "%mando%" },
      { type: "like", pattern: "%gamepad%" },
      { type: "like", pattern: "%joystick%" },
      { type: "like", pattern: "%dualsense%" },
      { type: "like", pattern: "%dualshock%" },
    ],
  },
  {
    id: "cargador",
    label: "Cargador / Power Bank",
    canonicalTerm: "cargador",
    isAccessoryConcept: true,
    triggers: [
      "bateria portatil",
      "power bank",
      "powerbank",
      "cargador",
      "cargadores",
      "charger",
    ],
    matchPatterns: [
      { type: "like", pattern: "%cargador%" },
      { type: "like", pattern: "%charger%" },
      { type: "regex", pattern: "power\\s*bank" },
      { type: "like", pattern: "%bateria portatil%" },
    ],
  },
  {
    id: "ssd",
    label: "SSD / Disco Duro",
    canonicalTerm: "ssd disco solido",
    isAccessoryConcept: true,
    triggers: [
      "unidad de estado solido",
      "disco de estado solido",
      "disco solido",
      "disco duro",
      "ssd",
      "nvme",
      "hdd",
    ],
    matchPatterns: [
      { type: "regex", pattern: "\\mssd\\M" },
      { type: "like", pattern: "%estado solido%" },
      { type: "like", pattern: "%disco solido%" },
      { type: "like", pattern: "%disco duro%" },
      { type: "regex", pattern: "\\mnvme\\M" },
      { type: "regex", pattern: "\\mhdd\\M" },
    ],
  },
];

// Índice precomputado de triggers ordenados de mayor a menor longitud (longest-first)
interface TriggerEntry {
  trigger: string;
  concept: SearchConcept;
  regex: RegExp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SORTED_TRIGGERS: TriggerEntry[] = CONCEPTS.flatMap((concept) =>
  concept.triggers.map((trigger) => ({
    trigger,
    concept,
    // Borde de palabra ASCII/alfanumérico para no recortar subcadenas dentro de otras palabras
    regex: new RegExp(`(^|[^a-z0-9/])${escapeRegExp(trigger)}(?=$|[^a-z0-9/])`, "i"),
  }))
).sort((a, b) => b.trigger.length - a.trigger.length);

// ---------------------------------------------------------------------------
// Normalización y stemming español seguro
// ---------------------------------------------------------------------------
function stripDiacriticsAndSymbols(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, " ")
    .toLowerCase()
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCodeOrSku(rawQuery: string, normalized: string): boolean {
  const rawTrimmed = rawQuery.trim();
  if (!rawTrimmed || /\s/.test(rawTrimmed)) return false;

  // Token único: si tiene un concepto conocido (ps5, pc5, ps4, a/c), NO es SKU
  if (
    /^(ps[345]|pc[45]|a\/c|tv|tvs|ssd|hdd|nvme|4k|8k|hd)$/i.test(normalized)
  ) {
    return false;
  }

  // Solo dígitos (ej. 155144) o código alfanumérico con dígitos (ej. QN55Q60D, VR242C31, V-5000AC)
  if (/^\d{4,}$/.test(rawTrimmed)) return true;
  if (/[a-z]/i.test(rawTrimmed) && /\d/.test(rawTrimmed) && rawTrimmed.length >= 4) {
    return true;
  }
  // Código en MAYÚSCULAS puras >= 6 chars sin ser palabra española conocida (ej. REGATEOXYZ)
  if (
    /^[A-Z0-9_-]{6,}$/.test(rawTrimmed) &&
    rawTrimmed === rawTrimmed.toUpperCase() &&
    !/^(SAMSUNG|IPHONE|LAPTOP|NEVERA|CONSOLA|MONITOR|TECLADO|TELEVISOR|LAVADORA|SECADORA|ESTUFA|ABANICO|CELULAR|TABLET|IMPRESORA|MICROONDAS|LICUADORA|AUDIFONOS|AURICULAR|PARLANTE|BOCINA|PLAYSTATION|NINTENDO|SMARTWATCH)$/.test(
      rawTrimmed
    )
  ) {
    return true;
  }
  return false;
}

function stemSpanishToken(token: string): { stem: string; altStems?: string[] } {
  if (!/^[a-z]{5,}$/.test(token) || NO_STEM_WORDS.has(token)) {
    return { stem: token };
  }
  if (token.endsWith("ces") && token.length >= 6) {
    return {
      stem: token.slice(0, -3) + "z",
      altStems: [token],
    };
  }
  // Plurales en -es tras consonantes típicas del español (televisores -> televisor, controles -> control)
  if (
    /(dor|tor|sor|lor|nor|por|vor|bol|rol|sol|tol|vol|ion|zon|ron|ton|pon|bon|don|fon|gon|mon|non|von|yon)es$/.test(
      token
    )
  ) {
    return { stem: token.slice(0, -2) };
  }
  if (
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return { stem: token.slice(0, -1) };
  }
  return { stem: token };
}

// ---------------------------------------------------------------------------
// Analizador principal de consultas
// ---------------------------------------------------------------------------
export function analyzeSearchQuery(rawQuery: string): SearchPlan {
  const baseNormalized = stripDiacriticsAndSymbols(rawQuery);
  const isCodeOrSku = detectCodeOrSku(rawQuery, baseNormalized);

  if (isCodeOrSku) {
    const cleanToken = baseNormalized || rawQuery.trim().toLowerCase();
    return {
      rawQuery,
      normalizedQuery: cleanToken,
      similarityQuery: cleanToken,
      matchedVia: "exact",
      expandedTerms: [],
      concepts: [],
      remainingTokens: [
        {
          raw: cleanToken,
          stem: cleanToken,
          useWordBoundary: false,
        },
      ],
      fuzzyTokens: [],
      hasUnmappedLongToken: false,
      isCodeOrSku: true,
      userWantsAccessory: false,
      primaryDevice: null,
    };
  }

  // 1. Corregir typos palabra por palabra
  const rawWords = baseNormalized.split(/\s+/).filter(Boolean);
  let typoFixed = false;
  const correctedWords: string[] = [];
  const correctedLabels: string[] = [];

  for (const word of rawWords) {
    const fixed = WORD_TYPO_MAP[word];
    if (fixed && fixed !== word) {
      typoFixed = true;
      correctedWords.push(fixed);
      correctedLabels.push(fixed);
    } else {
      correctedWords.push(word);
    }
  }

  const normalizedQuery = correctedWords.join(" ");
  const hasNonAcAirContext = correctedWords.some((w) => NON_AC_AIR_CONTEXT.has(w));

  // 2. Detectar intención explícita de accesorio/repuesto en la consulta
  const hasAccessoryWord = correctedWords.some((w) => ACCESSORY_INTENT_WORDS.has(w));
  const hasAccessoryPhrase = ACCESSORY_INTENT_PHRASES.some((phrase) =>
    normalizedQuery.includes(phrase)
  );

  // 3. Emparejar conceptos (longest-first)
  let working = normalizedQuery;
  const matchedConcepts: SearchConcept[] = [];
  const matchedConceptIds = new Set<string>();
  const expandedTermsSet = new Set<string>();
  let synonymExpanded = typoFixed;

  for (const entry of SORTED_TRIGGERS) {
    if (matchedConceptIds.has(entry.concept.id)) continue;
    // Evitar que "aire" suelto dispare aire acondicionado en "purificador de aire"
    if (
      entry.concept.id === "aire-acondicionado" &&
      entry.trigger === "aire" &&
      hasNonAcAirContext
    ) {
      continue;
    }

    const match = entry.regex.exec(working);
    if (!match) continue;

    matchedConceptIds.add(entry.concept.id);
    matchedConcepts.push(entry.concept);

    // Remover la coincidencia del texto restante para no re-emparejarla
    const leadingLen = match[1]?.length ?? 0;
    const startIdx = match.index + leadingLen;
    const endIdx = match.index + match[0].length;
    working = `${working.slice(0, startIdx)} ${working.slice(endIdx)}`
      .replace(/\s+/g, " ")
      .trim();

    // Determinar si hubo expansión de sinónimo/alias
    const triggerClean = entry.trigger.toLowerCase();
    const isAliasOrMultiPattern =
      entry.concept.matchPatterns.length > 1 ||
      Boolean(entry.concept.matchCategories?.length) ||
      triggerClean !== entry.concept.canonicalTerm;
    if (isAliasOrMultiPattern) {
      synonymExpanded = true;
      expandedTermsSet.add(entry.concept.label);
    }
  }

  for (const fixed of correctedLabels) {
    if (expandedTermsSet.size < 4) {
      expandedTermsSet.add(fixed);
    }
  }

  // 4. Procesar tokens restantes
  const rawRemaining = working
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));

  const meaningfulRemaining = rawRemaining.filter((t) => !STOPWORDS.has(t));
  const effectiveRemaining =
    meaningfulRemaining.length > 0
      ? meaningfulRemaining
      : matchedConcepts.length > 0
        ? []
        : rawRemaining.length > 0
          ? rawRemaining
          : normalizedQuery
            ? [normalizedQuery]
            : [];

  const remainingTokens = effectiveRemaining.slice(0, 5).map((token) => {
    const { stem, altStems } = stemSpanishToken(token);
    // Tokens cortos (2-3 chars alfanuméricos como "lg", "hp", "55", "4k") usan borde de palabra
    const useWordBoundary = /^[a-z0-9]{2,3}$/.test(stem);
    return { raw: token, stem, altStems, useWordBoundary };
  });

  const fuzzyTokens = remainingTokens
    .map((t) => t.raw)
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t));

  const hasUnmappedLongToken = fuzzyTokens.length > 0;

  // 5. Determinar si el usuario quiere accesorio y cuál es el dispositivo principal
  const userWantsAccessory =
    hasAccessoryWord ||
    hasAccessoryPhrase ||
    matchedConcepts.some((c) => c.isAccessoryConcept === true);

  const primaryConcept =
    matchedConcepts.find((c) => c.primaryDevice && !c.isAccessoryConcept) ?? null;

  const primaryDevice =
    !userWantsAccessory && primaryConcept?.primaryDevice
      ? primaryConcept.primaryDevice
      : null;

  // 6. Construir query canónica para similarity() de pg_trgm
  const simParts = [
    ...matchedConcepts.map((c) => c.canonicalTerm),
    ...remainingTokens.map((t) => t.raw),
  ];
  const similarityQuery = simParts.join(" ").trim() || normalizedQuery;

  return {
    rawQuery,
    normalizedQuery,
    similarityQuery,
    matchedVia: synonymExpanded ? "synonym" : "exact",
    expandedTerms: [...expandedTermsSet],
    concepts: matchedConcepts,
    remainingTokens,
    fuzzyTokens,
    hasUnmappedLongToken,
    isCodeOrSku: false,
    userWantsAccessory,
    primaryDevice,
  };
}

// ---------------------------------------------------------------------------
// Generadores de condiciones SQL (estricto y fallback fuzzy pg_trgm)
// ---------------------------------------------------------------------------
type SqlCond = ReturnType<typeof sql>;

function escapePostgresRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatternSqlForColumn(
  colExpr: ReturnType<typeof sql>,
  patterns: MatchPattern[]
): ReturnType<typeof sql>[] {
  const clauses: ReturnType<typeof sql>[] = [];
  const plainRegexParts: string[] = [];

  for (const p of patterns) {
    if (p.categories && p.categories.length > 0) {
      // Patrón con restricción de categoría (se maneja aparte en buildConceptCondition)
      continue;
    }
    if (p.type === "regex") {
      plainRegexParts.push(`(${p.pattern})`);
    } else {
      // Convertir %foo% a subcadena en regex para combinar en una sola evaluación de unaccent()
      const inner = p.pattern.replace(/^%+/, "").replace(/%+$/, "");
      if (inner) {
        plainRegexParts.push(escapePostgresRegex(inner));
      }
    }
  }

  if (plainRegexParts.length > 0) {
    const combinedRegex = plainRegexParts.join("|");
    clauses.push(sql`${colExpr} ~* ${combinedRegex}`);
  }
  return clauses;
}

function buildConceptCondition(concept: SearchConcept): SqlCond {
  const productTextExpr = sql`unaccent(lower(${products.canonicalName} || ' ' || coalesce(${products.brand}, '') || ' ' || coalesce(${products.modelNumber}, '') || ' ' || ${products.slug}))`;
  const listingTitleExpr = sql`unaccent(lower(sl.title_at_store))`;

  const orBranches: SqlCond[] = [];

  // 1. Patrones generales sobre el producto (una sola evaluación unaccent + regex)
  orBranches.push(...buildPatternSqlForColumn(productTextExpr, concept.matchPatterns));

  // 2. Patrones restringidos a categorías específicas (ej. %portatil% en computadoras)
  for (const p of concept.matchPatterns) {
    if (!p.categories || p.categories.length === 0) continue;
    const matchClause =
      p.type === "regex"
        ? sql`${productTextExpr} ~* ${p.pattern}`
        : sql`${productTextExpr} like ${p.pattern}`;
    orBranches.push(
      sql`(${inArray(products.category, p.categories)} and ${matchClause})`
    );
  }

  // 3. Categorías completas asociadas al concepto (ej. `celulares` para "celular")
  if (concept.matchCategories && concept.matchCategories.length > 0) {
    orBranches.push(inArray(products.category, concept.matchCategories) as unknown as SqlCond);
  }

  // 4. Un único EXISTS en store_listings para patrones generales (cortocircuitado si ya coincidió arriba)
  const listingClauses = buildPatternSqlForColumn(listingTitleExpr, concept.matchPatterns);
  if (listingClauses.length > 0) {
    const listingWhere =
      listingClauses.length === 1 ? listingClauses[0] : (or(...listingClauses) as SqlCond);
    orBranches.push(
      sql`exists (select 1 from ${storeListings} sl where sl.product_id = ${products.id} and (${listingWhere}))`
    );
  }

  return (orBranches.length === 1 ? orBranches[0] : or(...orBranches)) as SqlCond;
}

function buildTokenCondition(
  token: SearchPlan["remainingTokens"][number],
  fuzzy: boolean
): SqlCond {
  if (fuzzy && token.raw.length >= 4 && !/^\d+$/.test(token.raw)) {
    return or(
      sql`word_similarity(unaccent(lower(${token.raw})), unaccent(lower(${products.canonicalName}))) >= 0.42`,
      sql`word_similarity(unaccent(lower(${token.raw})), unaccent(lower(coalesce(${products.brand}, '')))) >= 0.50`
    ) as unknown as SqlCond;
  }

  if (token.useWordBoundary) {
    const wbRegex = `\\m${escapePostgresRegex(token.stem)}\\M`;
    const productTextExpr = sql`unaccent(lower(${products.canonicalName} || ' ' || coalesce(${products.brand}, '') || ' ' || coalesce(${products.modelNumber}, '') || ' ' || ${products.slug}))`;
    return or(
      sql`${productTextExpr} ~* ${wbRegex}`,
      sql`exists (select 1 from ${storeListings} sl where sl.product_id = ${products.id} and (unaccent(lower(sl.title_at_store)) ~* ${wbRegex} or lower(sl.external_id) like ${`%${token.stem}%`}))`
    ) as unknown as SqlCond;
  }

  const stems = [token.stem, ...(token.altStems ?? [])];
  const branches: SqlCond[] = [];
  for (const s of stems) {
    const like = `%${s}%`;
    branches.push(
      sql`unaccent(lower(${products.canonicalName})) like unaccent(lower(${like}))`,
      sql`unaccent(lower(coalesce(${products.brand}, ''))) like unaccent(lower(${like}))`,
      sql`lower(coalesce(${products.modelNumber}, '')) like lower(${like})`,
      sql`unaccent(lower(${products.slug})) like unaccent(lower(${like}))`,
      sql`exists (select 1 from ${storeListings} sl where sl.product_id = ${products.id} and (unaccent(lower(sl.title_at_store)) like unaccent(lower(${like})) or lower(sl.external_id) like lower(${like})))`
    );
  }
  return or(...branches) as unknown as SqlCond;
}

export function buildSearchConditions(
  plan: SearchPlan,
  options: { fuzzy?: boolean } = {}
): SqlCond[] {
  const fuzzy = Boolean(options.fuzzy);
  const conditions: SqlCond[] = [];

  for (const concept of plan.concepts) {
    conditions.push(buildConceptCondition(concept));
  }

  for (const token of plan.remainingTokens) {
    conditions.push(buildTokenCondition(token, fuzzy));
  }

  return conditions;
}

// ---------------------------------------------------------------------------
// Clasificador SQL de Tier (0 = Producto principal, 1 = Secundario, 2 = Accesorio/Repuesto)
// ---------------------------------------------------------------------------
const WARRANTY_OR_SERVICE_REGEX =
  "\\m(garantia\\s+extendida|plan\\s+de\\s+proteccion|instalacion\\s+de|mantenimiento\\s+de|servicio\\s+de\\s+instalacion)\\M";

// Palabras de accesorio/repuesto al inicio del título (primeras ~4 palabras, ej. "Sankey Soporte de Pared...")
// Evita falsos positivos con características tras "con ..." (ej. "Aire Acondicionado ... Con Filtro Y Control Remoto")
const ACCESSORY_HEAD_REGEX =
  "^\\s*([a-z0-9.\\-_/]+\\s+){0,3}(\\|\\s*)?(soporte|soportes|base\\s+(metalica|de|para|enfriadora)|brazo|rack|filtro|filtros|protector|protectores|control(\\s+remoto|\\s+universal|\\s+inalambrico|\\s+dualsense|\\s+xbox)?|controlador|mando|funda|fundas|estuche|cover|forro|case|cable|cables|cargador|adaptador|antena|convertidor|splitter|conmutador|regleta|manguera|tuerca|valvula|repuesto|conector|vidrio|mica|lamina|limpiador|espuma|organizador|deodorizador|tarjetero|porta\\s+|disparador|tapas|videojuego|paquete\\s+completo|accesorio|mochila|maletin|bolso|tinta|toner|cartucho|mousepad|candado|kit\\s+de)\\M";

export function buildRelevanceTierExpr(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bestPriceCentsCol: any,
  plan: SearchPlan | null
): ReturnType<typeof sql<number>> | null {
  if (!plan) return null;

  const normName = sql`unaccent(lower(${products.canonicalName}))`;

  // Si el usuario pidió explícitamente un accesorio (ej. "control ps5", "audifonos ps5"),
  // priorizar en Tier 0 los productos cuyo canonical_name coincide realmente con ese accesorio
  // (evita que unos auriculares que mencionan "control de volumen" en otro listing ganen a DualSense).
  if (plan.userWantsAccessory) {
    const accessoryConcept = plan.concepts.find((c) => c.isAccessoryConcept);
    if (accessoryConcept) {
      const nameMatches = buildPatternSqlForColumn(normName, accessoryConcept.matchPatterns);
      if (nameMatches.length > 0) {
        const matchExpr = nameMatches.length === 1 ? nameMatches[0]! : sql.join(nameMatches, sql` or `);
        return sql<number>`(case when coalesce(${bestPriceCentsCol}, 0) <= 0 then 2 when (${matchExpr}) then 0 else 1 end)`;
      }
    }
    return null;
  }

  if (!plan.primaryDevice) {
    return null;
  }

  const pd = plan.primaryDevice;

  // Regla contextual: "para / p/ / compatible con / apto para / repuesto de ... <concept>"
  const contextualParaRegex = `(\\m(para|compatibles?\\s+con|apto\\s+para|repuestos?\\s+(de|para)|accesorios?\\s+(de|para))\\M|\\mp/)\\s*[^|]{0,45}${pd.conceptNameRegex}`;

  const tier2Checks: ReturnType<typeof sql>[] = [
    // Precio inválido o por debajo del piso realista del dispositivo principal
    sql`coalesce(${bestPriceCentsCol}, 0) <= 0`,
    sql`${bestPriceCentsCol} < ${pd.minPriceCents}`,
    // Garantías extendidas y servicios
    sql`${normName} ~* ${WARRANTY_OR_SERVICE_REGEX}`,
    // Accesorio contextual ("para aire acondicionado", "compatible con PS5", "p/nevera")
    sql`${normName} ~* ${contextualParaRegex}`,
    // Título encabezado por palabra de accesorio/repuesto
    sql`${normName} ~* ${ACCESSORY_HEAD_REGEX}`,
  ];

  // Categoría 'accesorios' solo penaliza si el dispositivo principal NO vive en 'accesorios' (ej. impresoras sí viven ahí)
  if (!pd.preferredCategories.includes("accesorios")) {
    tier2Checks.push(sql`${products.category} = 'accesorios'`);
  }

  // Términos no-principales propios de este dispositivo (ej. auriculares/portal/gamepad/ssd para PS5)
  if (pd.extraAccessoryRegex) {
    tier2Checks.push(sql`${normName} ~* ${pd.extraAccessoryRegex}`);
  }

  const tier2Condition = sql.join(tier2Checks, sql` or `);

  // Tier 0 exige señal positiva en canonical_name (así coincidencias solo por title_at_store o categoría quedan en Tier 1)
  const tier0Condition = sql`${normName} ~* ${pd.positiveRegex}`;

  return sql<number>`(case when (${tier2Condition}) then 2 when (${tier0Condition}) then 0 else 1 end)`;
}
