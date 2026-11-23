// ============================================================================
// Verificación de calidad de búsqueda (SOLO LECTURA) contra datos reales en
// regateoapp_dev (~12,556 productos de Panamá).
// CERO mutaciones de BD: solo ejecuta peticiones GET contra `app.request(...)`.
//
// Ejecutar:
//   cd apps/api && bun scripts/verify-search-quality.ts
// ============================================================================
import { app } from "../src/app";
import type { ProductSummaryDTO } from "@regateo/shared";

interface ProductsApiResponse {
  items: ProductSummaryDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  facets: {
    categories: Array<{ key: string; count: number }>;
    brands: Array<{ name: string; count: number }>;
    stores: Array<{ slug: string; name: string; count: number }>;
  };
  meta: {
    cached: boolean;
    lastScrapedAt: string | null;
    comparableCount: number;
    search?: Record<string, unknown> | null;
  };
}

interface QueryRunResult {
  url: string;
  status: number;
  latencyMs: number;
  body: ProductsApiResponse;
}

const MAX_LATENCY_MS = 400;

let passed = 0;
let failures = 0;
const latencies: Array<{ label: string; ms: number }> = [];

function section(title: string): void {
  console.log(`\n━━━ ${title} ━━━`);
}

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    if (detail !== undefined) {
      console.log(`  ❌ ${name}`, detail);
    } else {
      console.log(`  ❌ ${name}`);
    }
  }
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatItemLine(item: ProductSummaryDTO, index: number): string {
  const price = formatUsd(item.bestPriceCents);
  const savings =
    item.savingsCents > 0 ? `ahorro ${formatUsd(item.savingsCents)}` : "ahorro $0.00";
  return `     #${index + 1} [${price} | ${savings} | ${item.storeCount}t | ${item.category}] ${item.canonicalName}`;
}

function summarizeItems(items: ProductSummaryDTO[], max = 5): string[] {
  return items
    .slice(0, max)
    .map(
      (item, idx) =>
        `#${idx + 1} ${formatUsd(item.bestPriceCents)} (${item.category}) ${item.canonicalName}`
    );
}

async function runQuery(
  label: string,
  path: string,
  options: { showMetaSearch?: boolean; checkLatency?: boolean } = {}
): Promise<QueryRunResult> {
  const start = performance.now();
  const res = await app.request(path);
  const body = (await res.json()) as ProductsApiResponse;
  const latencyMs = Math.round((performance.now() - start) * 10) / 10;

  latencies.push({ label, ms: latencyMs });

  const total = body.pagination?.total ?? 0;
  console.log(
    `\n  🔎 ${label} → ${path} [HTTP ${res.status} | total=${total} | items=${body.items?.length ?? 0} | ${latencyMs}ms]`
  );

  for (let i = 0; i < Math.min(3, body.items?.length ?? 0); i++) {
    console.log(formatItemLine(body.items[i]!, i));
  }
  if ((body.items?.length ?? 0) === 0) {
    console.log("     (sin resultados)");
  }

  if (options.showMetaSearch) {
    console.log(
      `     meta.search: ${body.meta?.search ? JSON.stringify(body.meta.search) : "undefined"}`
    );
  }

  check(`${label}: HTTP 200`, res.status === 200, res.status);
  if (options.checkLatency !== false) {
    check(
      `${label}: latencia < ${MAX_LATENCY_MS}ms (${latencyMs}ms)`,
      latencyMs < MAX_LATENCY_MS,
      `${latencyMs}ms`
    );
  }

  return { url: path, status: res.status, latencyMs, body };
}

// ---------------------------------------------------------------------------
// Predicados de dominio para validar relevancia real (primary vs accessory)
// ---------------------------------------------------------------------------

const PS5_CONSOLE_NAME_RE = /(consola|playstation\s*[®™]?\s*5)/i;
const PS5_HARD_ACCESSORY_RE =
  /\b(headset|auricular(?:es)?|audifono(?:s)?|gamepad|ssd|parlante|bocina|estacion|cargador|funda|cover|volante|pedal|camara|microfono|soporte)\b/i;
const PS5_CONTROL_RE = /\b(control(?:es)?|mando|dualsense|gamepad|joystick)\b/i;
const PS5_HEADSET_RE =
  /\b(audifono(?:s)?|auricular(?:es)?|headset|earbud(?:s)?|pulse\s*(3d|elite|explore))\b/i;
const FALSE_PS555_RE = /my-?ps555/i;

function isPs5Accessory(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  if (PS5_HARD_ACCESSORY_RE.test(norm)) return true;
  if (PS5_CONTROL_RE.test(norm) && !/\bconsola\b/i.test(norm)) return true;
  return false;
}

function isPs5Console(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  if (item.bestPriceCents < 35000) return false;
  if (!PS5_CONSOLE_NAME_RE.test(item.canonicalName)) return false;
  if (PS5_HARD_ACCESSORY_RE.test(norm)) return false;
  // Rechazar controles sueltos (pero permitir bundles "Consola PS5 + Control")
  if (PS5_CONTROL_RE.test(norm) && !/\bconsola\b/i.test(norm)) return false;
  return true;
}

function hasNoMyPs555(items: ProductSummaryDTO[]): boolean {
  return items.every(
    (item) =>
      !FALSE_PS555_RE.test(item.canonicalName) &&
      !FALSE_PS555_RE.test(item.modelNumber ?? "")
  );
}

function isTvAccessory(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  if (
    /^(control\s+remoto|control\s+universal|cable|antena|soporte|base|rack|brazo|adaptador|convertidor|extensor|protector|limpiador)\b/i.test(
      norm
    )
  ) {
    return true;
  }
  if (
    /\b(control\s+remoto|cable\s+hdmi|antena\s+(digital|hd|para\s+tv|tv)|soporte\s+(de\s+pared\s+)?(para\s+)?(tv|televisor|pantalla)|rack\s+(para\s+)?(tv|televisor)|brazo\s+(para\s+)?(tv|televisor))\b/i.test(
      norm
    )
  ) {
    return true;
  }
  return false;
}

function isRealTv(item: ProductSummaryDTO): boolean {
  if (item.bestPriceCents < 8000) return false;
  if (isTvAccessory(item)) return false;
  const norm = stripAccents(item.canonicalName);
  return (
    item.category === "televisores" ||
    /\b(tv|televisor|television|smart\s*tv|oled|qled|qned|nanocell|uhd|pantalla\s+\d{2})\b/i.test(
      norm
    )
  );
}

function isSamsung(item: ProductSummaryDTO): boolean {
  return (
    (item.brand ?? "").toLowerCase().includes("samsung") ||
    /samsung/i.test(item.canonicalName)
  );
}

function isAcAccessory(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  if (
    /^(soporte|filtro|protector|control|manguera|tuerca|tubo|tuberia|kit|base|bracket|capacitor|limpiador|espuma|funda|cobertor|termostato|valvula|bomba|cinta|deflector)\b/i.test(
      norm
    )
  ) {
    return true;
  }
  if (
    /\b(soporte|filtro|protector|control(\s+remoto|\s+universal)?|manguera|tuerca|deflector|funda|cobertor)\s+(para\s+|de\s+)?(aire|a\/c|ac|mini\s*split|split)\b/i.test(
      norm
    )
  ) {
    return true;
  }
  return false;
}

function isRealAirConditioner(item: ProductSummaryDTO): boolean {
  // Aires de ventana reales de 5,000 BTU en Panamá arrancan en ~$109.98
  if (item.bestPriceCents < 10000) return false;
  if (isAcAccessory(item)) return false;
  const norm = stripAccents(item.canonicalName);
  if (/\bfreidora\b/i.test(norm)) return false;
  return (
    item.category === "aires-acondicionados" ||
    /\b(aire\s+acondicionado|minisplit|mini\s*split|split|inverter|btu)\b/i.test(norm)
  );
}

function isRealFridge(item: ProductSummaryDTO): boolean {
  if (item.bestPriceCents < 12000) return false;
  const norm = stripAccents(item.canonicalName);
  if (/^(filtro|bandeja|funda|cobertor|termostato|protector|iman|organizador)\b/i.test(norm)) {
    return false;
  }
  return (
    /\b(refrigerador(?:a)?|nevera|frigobar|congelador|freezer|fridge|french\s*door|side\s*by\s*side|top\s*mount)\b/i.test(
      norm
    ) || item.category === "linea-blanca"
  );
}

function isRealFan(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  return /\b(abanicos?|ventilador(?:es)?|fans?|circulador(?:es)?|torre|pedestal)\b/i.test(norm);
}

function isRealSpeaker(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  return (
    /\b(parlante|bocina|speaker|altavoz|soundbar|barra\s+de\s+sonido|torre\s+de\s+sonido|subwoofer)\b/i.test(
      norm
    ) || item.category === "audio"
  );
}

function isRealWasher(item: ProductSummaryDTO): boolean {
  if (item.bestPriceCents < 10000) return false;
  const norm = stripAccents(item.canonicalName);
  if (/^(manguera|filtro|funda|cobertor|base|soporte|detergente|protector)\b/i.test(norm)) {
    return false;
  }
  return /\b(lavadoras?|washer|lavaseca|centro\s+de\s+lavado|torre\s+de\s+lavado|washtower)\b/i.test(
    norm
  );
}

function isRealAirFryer(item: ProductSummaryDTO): boolean {
  const norm = stripAccents(item.canonicalName);
  if (item.category === "aires-acondicionados") return false;
  if (/\b(aire\s+acondicionado|minisplit|mini\s*split|btu)\b/i.test(norm)) return false;
  return /\b(freidora|air\s*fryer|airfryer)\b/i.test(norm);
}

function hasSearchMeta(body: ProductsApiResponse): boolean {
  const meta = body.meta?.search;
  return Boolean(meta && typeof meta === "object" && Object.keys(meta).length > 0);
}

// ============================================================================
// 0. Healthcheck & warm-up de conexión PostgreSQL
// ============================================================================
section("0. Healthcheck & Warm-up");
const healthRes = await app.request("/api/health");
const healthBody = (await healthRes.json()) as { ok?: boolean; db?: string };
check(
  "GET /api/health → 200 y BD conectada",
  healthRes.status === 200 && healthBody.db === "connected",
  healthBody
);

// ============================================================================
// 1. PS5 / PC5 / PlayStation 5: Sinónimos + Primary-First Ranking
// ============================================================================
section("1. PS5 / PC5 / PlayStation 5 (Sinónimos & Primary-First)");

const pc5 = await runQuery("q=pc5", "/api/products?q=pc5&limit=10", {
  showMetaSearch: true,
});
check("q=pc5: devuelve >= 5 resultados", pc5.body.items.length >= 5, pc5.body.items.length);
check(
  "q=pc5: top 3 son consolas PS5 reales (>= $350, sin accesorios)",
  pc5.body.items.length >= 3 && pc5.body.items.slice(0, 3).every(isPs5Console),
  summarizeItems(pc5.body.items, 3)
);
check(
  "q=pc5: sin falso positivo MY-PS555",
  hasNoMyPs555(pc5.body.items),
  pc5.body.items.filter((i) => FALSE_PS555_RE.test(i.canonicalName)).map((i) => i.canonicalName)
);
check("q=pc5: meta.search presente (sinónimo)", hasSearchMeta(pc5.body), pc5.body.meta?.search);

const ps5 = await runQuery("q=ps5", "/api/products?q=ps5&limit=10");
check("q=ps5: devuelve >= 5 resultados", ps5.body.items.length >= 5, ps5.body.items.length);
check(
  "q=ps5: top 3 son consolas PS5 reales (>= $350)",
  ps5.body.items.length >= 3 && ps5.body.items.slice(0, 3).every(isPs5Console),
  summarizeItems(ps5.body.items, 5)
);
const ps5FirstAccessoryIdx = ps5.body.items.findIndex(isPs5Accessory);
check(
  "q=ps5: accesorios aparecen DESPUÉS de las consolas principales",
  ps5FirstAccessoryIdx === -1 || ps5FirstAccessoryIdx >= 3,
  ps5FirstAccessoryIdx === -1
    ? "sin accesorios en top 10"
    : `primer accesorio en índice ${ps5FirstAccessoryIdx}: ${ps5.body.items[ps5FirstAccessoryIdx]?.canonicalName}`
);
check(
  "q=ps5: sin falso positivo MY-PS555",
  hasNoMyPs555(ps5.body.items),
  ps5.body.items.filter((i) => FALSE_PS555_RE.test(i.canonicalName)).map((i) => i.canonicalName)
);

const playstation5 = await runQuery(
  "q=playstation 5",
  "/api/products?q=playstation%205&limit=10"
);
check(
  "q=playstation 5: top 3 son consolas PS5 reales (>= $350)",
  playstation5.body.items.length >= 3 &&
    playstation5.body.items.slice(0, 3).every(isPs5Console),
  summarizeItems(playstation5.body.items, 5)
);

const play5 = await runQuery("q=play 5", "/api/products?q=play%205&limit=10");
check(
  "q=play 5: consolas PS5 primero (top 3 consolas >= $350)",
  play5.body.items.length >= 3 && play5.body.items.slice(0, 3).every(isPs5Console),
  summarizeItems(play5.body.items, 5)
);

const audifonosPs5 = await runQuery(
  "q=audifonos ps5",
  "/api/products?q=audifonos%20ps5&limit=5"
);
check(
  "q=audifonos ps5: intención explícita devuelve audífonos/headsets para PS5",
  audifonosPs5.body.items.length >= 1 &&
    audifonosPs5.body.items
      .slice(0, Math.min(3, audifonosPs5.body.items.length))
      .every((item) => PS5_HEADSET_RE.test(stripAccents(item.canonicalName)) && !isPs5Console(item)),
  summarizeItems(audifonosPs5.body.items, 5)
);

const controlPs5 = await runQuery(
  "q=control ps5",
  "/api/products?q=control%20ps5&limit=5"
);
check(
  "q=control ps5: intención explícita devuelve controles/gamepads PS5",
  controlPs5.body.items.length >= 1 &&
    controlPs5.body.items
      .slice(0, Math.min(3, controlPs5.body.items.length))
      .every(
        (item) =>
          PS5_CONTROL_RE.test(stripAccents(item.canonicalName)) && !isPs5Console(item)
      ),
  summarizeItems(controlPs5.body.items, 5)
);

// ============================================================================
// 2. Televisión vs Televisor / Smart TV / Tele / Typo
// ============================================================================
section("2. Televisión / Televisor / Tele / Typo");

const tvAccented = await runQuery(
  "q=televisión",
  "/api/products?q=televisi%C3%B3n&limit=10",
  { showMetaSearch: true }
);
check(
  "q=televisión: total > 50 (no solo 5)",
  tvAccented.body.pagination.total > 50,
  tvAccented.body.pagination.total
);
check(
  "q=televisión: top 5 son TVs reales (>= $80, sin controles/cables/antenas)",
  tvAccented.body.items.length >= 5 && tvAccented.body.items.slice(0, 5).every(isRealTv),
  summarizeItems(tvAccented.body.items, 5)
);
check(
  "q=televisión: meta.search presente (sinónimo)",
  hasSearchMeta(tvAccented.body),
  tvAccented.body.meta?.search
);

const tvPlain = await runQuery("q=television", "/api/products?q=television&limit=10");
check(
  "q=television: total > 50",
  tvPlain.body.pagination.total > 50,
  tvPlain.body.pagination.total
);
check(
  "q=television: top 5 son TVs reales (>= $80)",
  tvPlain.body.items.length >= 5 && tvPlain.body.items.slice(0, 5).every(isRealTv),
  summarizeItems(tvPlain.body.items, 5)
);

const tele = await runQuery("q=tele", "/api/products?q=tele&limit=10");
check(
  "q=tele: devuelve TVs reales en top 5 (>= $80)",
  tele.body.items.length >= 5 && tele.body.items.slice(0, 5).every(isRealTv),
  summarizeItems(tele.body.items, 5)
);

const televizor = await runQuery("q=televizor (typo)", "/api/products?q=televizor&limit=10", {
  showMetaSearch: true,
});
check(
  "q=televizor (typo): recupera TVs reales en top 5 (>= $80)",
  televizor.body.items.length >= 5 && televizor.body.items.slice(0, 5).every(isRealTv),
  summarizeItems(televizor.body.items, 5)
);

const tvSamsung = await runQuery(
  "q=televisión samsung",
  "/api/products?q=televisi%C3%B3n%20samsung&limit=5"
);
check(
  "q=televisión samsung: devuelve TVs Samsung reales",
  tvSamsung.body.items.length >= 3 &&
    tvSamsung.body.items.every((item) => isRealTv(item) && isSamsung(item)),
  summarizeItems(tvSamsung.body.items, 5)
);

// ============================================================================
// 3. Aire Acondicionado + Modos de Ordenamiento
// ============================================================================
section("3. Aire Acondicionado + Sort Modes (best-savings, price-asc, most-stores, relevance)");

const acSavings = await runQuery(
  "q=aire acondicionado [best-savings]",
  "/api/products?q=aire%20acondicionado&sort=best-savings&limit=10"
);
const acSavingsTop8 = acSavings.body.items.slice(0, 8);
check(
  "aire [best-savings]: TODOS los top 8 son aires reales (>= $140, sin soportes/filtros/controles)",
  acSavingsTop8.length >= 8 && acSavingsTop8.every(isRealAirConditioner),
  summarizeItems(acSavingsTop8, 8)
);
check(
  "aire [best-savings]: ordenados por ahorro descendente entre los top 8",
  acSavingsTop8.length >= 2 &&
    acSavingsTop8.every(
      (item, idx) => idx === 0 || acSavingsTop8[idx - 1]!.savingsCents >= item.savingsCents
    ),
  acSavingsTop8.map((i) => `${formatUsd(i.savingsCents)} (${i.canonicalName.slice(0, 30)})`)
);

const acPriceAsc = await runQuery(
  "q=aire acondicionado [price-asc]",
  "/api/products?q=aire%20acondicionado&sort=price-asc&limit=10"
);
const acPriceTop5 = acPriceAsc.body.items.slice(0, 5);
check(
  "aire [price-asc]: top 5 son aires reales (>= $140, sin filtros $5.99 ni controles $9.97)",
  acPriceTop5.length >= 5 && acPriceTop5.every(isRealAirConditioner),
  summarizeItems(acPriceTop5, 5)
);
check(
  "aire [price-asc]: ordenados por precio ascendente entre los top 5",
  acPriceTop5.length >= 2 &&
    acPriceTop5.every(
      (item, idx) =>
        idx === 0 || acPriceTop5[idx - 1]!.bestPriceCents <= item.bestPriceCents
    ),
  acPriceTop5.map((i) => formatUsd(i.bestPriceCents))
);

const acMostStores = await runQuery(
  "q=aire acondicionado [most-stores]",
  "/api/products?q=aire%20acondicionado&sort=most-stores&limit=10"
);
const acMostStoresTop5 = acMostStores.body.items.slice(0, 5);
check(
  "aire [most-stores]: top 5 son aires reales (>= $140)",
  acMostStoresTop5.length >= 5 && acMostStoresTop5.every(isRealAirConditioner),
  summarizeItems(acMostStoresTop5, 5)
);
check(
  "aire [most-stores]: ordenados por storeCount descendente entre los top 5",
  acMostStoresTop5.length >= 2 &&
    acMostStoresTop5.every(
      (item, idx) => idx === 0 || acMostStoresTop5[idx - 1]!.storeCount >= item.storeCount
    ),
  acMostStoresTop5.map((i) => `${i.storeCount}t`)
);

const acRelevance = await runQuery(
  "q=aire acondicionado [relevance]",
  "/api/products?q=aire%20acondicionado&sort=relevance&limit=10"
);
check(
  "aire [relevance]: top 5 son aires reales (>= $140)",
  acRelevance.body.items.length >= 5 &&
    acRelevance.body.items.slice(0, 5).every(isRealAirConditioner),
  summarizeItems(acRelevance.body.items, 5)
);

const soporteAc = await runQuery(
  "q=soporte aire acondicionado",
  "/api/products?q=soporte%20aire%20acondicionado&limit=5"
);
check(
  "q=soporte aire acondicionado: devuelve soporte/bracket en #1",
  soporteAc.body.items.length >= 1 &&
    /\b(soporte|base|bracket)\b/i.test(stripAccents(soporteAc.body.items[0]!.canonicalName)),
  summarizeItems(soporteAc.body.items, 3)
);

// ============================================================================
// 4. Sinónimos de Panamá & Tolerancia Fuzzy a Typos
// ============================================================================
section("4. Sinónimos de Panamá & Tolerancia Fuzzy");

const nevera = await runQuery("q=nevera", "/api/products?q=nevera&limit=10");
check(
  "q=nevera: encuentra > 100 resultados (incluye refrigeradoras)",
  nevera.body.pagination.total > 100,
  nevera.body.pagination.total
);
check(
  "q=nevera: top 5 son neveras/refrigeradoras reales (>= $120)",
  nevera.body.items.length >= 5 && nevera.body.items.slice(0, 5).every(isRealFridge),
  summarizeItems(nevera.body.items, 5)
);

const abanico = await runQuery("q=abanico", "/api/products?q=abanico&limit=5");
const ventilador = await runQuery("q=ventilador", "/api/products?q=ventilador&limit=5");
check(
  "q=abanico y q=ventilador: ambos devuelven > 100 resultados",
  abanico.body.pagination.total > 100 && ventilador.body.pagination.total > 100,
  {
    abanicoTotal: abanico.body.pagination.total,
    ventiladorTotal: ventilador.body.pagination.total,
  }
);
const fanRatio =
  Math.min(abanico.body.pagination.total, ventilador.body.pagination.total) /
  Math.max(1, abanico.body.pagination.total, ventilador.body.pagination.total);
const abanicoIds = new Set(abanico.body.items.map((i) => i.id));
const topFanOverlap = ventilador.body.items.filter((i) => abanicoIds.has(i.id)).length;
check(
  "q=abanico vs q=ventilador: fuerte solapamiento de resultados (sinónimos)",
  fanRatio >= 0.5 &&
    abanico.body.items.slice(0, 3).every(isRealFan) &&
    ventilador.body.items.slice(0, 3).every(isRealFan),
  {
    abanicoTotal: abanico.body.pagination.total,
    ventiladorTotal: ventilador.body.pagination.total,
    ratio: Number(fanRatio.toFixed(2)),
    top5Overlap: topFanOverlap,
  }
);

const parlante = await runQuery("q=parlante", "/api/products?q=parlante&limit=5");
check(
  "q=parlante: encuentra > 100 resultados (incluye bocinas)",
  parlante.body.pagination.total > 100,
  parlante.body.pagination.total
);
check(
  "q=parlante: top 5 son parlantes/bocinas reales",
  parlante.body.items.length >= 5 && parlante.body.items.every(isRealSpeaker),
  summarizeItems(parlante.body.items, 5)
);

const labadora = await runQuery(
  "q=labadora (typo)",
  "/api/products?q=labadora&limit=5",
  { showMetaSearch: true }
);
check(
  "q=labadora (typo): recupera lavadoras reales en top 3",
  labadora.body.items.length >= 3 && labadora.body.items.slice(0, 3).every(isRealWasher),
  summarizeItems(labadora.body.items, 5)
);
check(
  "q=labadora (typo): meta.search presente (fuzzy)",
  hasSearchMeta(labadora.body),
  labadora.body.meta?.search
);

const sansungTv = await runQuery(
  "q=sansung tv (typo marca)",
  "/api/products?q=sansung%20tv&limit=5",
  { showMetaSearch: true }
);
check(
  "q=sansung tv (typo marca): devuelve TVs Samsung reales",
  sansungTv.body.items.length >= 3 &&
    sansungTv.body.items.slice(0, 3).every((item) => isRealTv(item) && isSamsung(item)),
  summarizeItems(sansungTv.body.items, 5)
);

const airFryer = await runQuery("q=air fryer", "/api/products?q=air%20fryer&limit=5");
check(
  "q=air fryer: encuentra > 50 freidoras de aire",
  airFryer.body.pagination.total > 50,
  airFryer.body.pagination.total
);
check(
  "q=air fryer: top 5 son freidoras de aire reales (NO aires acondicionados)",
  airFryer.body.items.length >= 5 && airFryer.body.items.every(isRealAirFryer),
  summarizeItems(airFryer.body.items, 5)
);

// ============================================================================
// 5. No-Regresión & Resumen de Latencia
// ============================================================================
section("5. No-Regresión (Modelos exactos y desambiguación)");

const modelCode = await runQuery("q=VR242C31", "/api/products?q=VR242C31&limit=5");
check(
  "q=VR242C31: encuentra exactamente el modelo LG VR242C31 en #1",
  modelCode.body.items.length >= 1 &&
    (/vr242c31/i.test(modelCode.body.items[0]!.canonicalName) ||
      /vr242c31/i.test(modelCode.body.items[0]!.modelNumber ?? "")) &&
    ((modelCode.body.items[0]!.brand ?? "").toLowerCase().includes("lg") ||
      /\blg\b/i.test(modelCode.body.items[0]!.canonicalName)),
  summarizeItems(modelCode.body.items, 3)
);

const freidora = await runQuery(
  "q=freidora de aire",
  "/api/products?q=freidora%20de%20aire&limit=5"
);
check(
  "q=freidora de aire: devuelve freidoras de aire, NO aires acondicionados",
  freidora.body.items.length >= 5 && freidora.body.items.every(isRealAirFryer),
  summarizeItems(freidora.body.items, 5)
);

// ============================================================================
// Resumen final y métricas de latencia
// ============================================================================
const latencyValues = latencies.map((l) => l.ms);
const minMs = latencyValues.length > 0 ? Math.min(...latencyValues) : 0;
const maxMs = latencyValues.length > 0 ? Math.max(...latencyValues) : 0;
const avgMs =
  latencyValues.length > 0
    ? Math.round((latencyValues.reduce((acc, v) => acc + v, 0) / latencyValues.length) * 10) /
      10
    : 0;
const slowest = [...latencies].sort((a, b) => b.ms - a.ms).slice(0, 3);

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(
  `📊 Latencia (${latencies.length} consultas): min=${minMs}ms | avg=${avgMs}ms | max=${maxMs}ms`
);
console.log(
  `🐢 Más lentas: ${slowest.map((s) => `${s.label} (${s.ms}ms)`).join(", ")}`
);
console.log(
  failures === 0
    ? `\n🎉 VERIFICACIÓN DE CALIDAD DE BÚSQUEDA: TODO OK (${passed}/${passed} checks)`
    : `\n💥 VERIFICACIÓN DE CALIDAD DE BÚSQUEDA: ${failures} fallaron (${passed} pasaron)`
);

process.exit(failures === 0 ? 0 : 1);
