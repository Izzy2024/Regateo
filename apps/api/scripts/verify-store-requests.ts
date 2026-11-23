// ============================================================================
// Verificación real de "Sugerencias de Tiendas" (Sprint 6 + 7) contra PostgreSQL:
// 1) tienda ya monitoreada (nombre y dominio) → 200 alreadyMonitored
// 1c) aliases panameños de las 13 tiendas (Raenco, PlayNTrade, Samsung Shop PA,
//     LG Shop PA, eVision Store…) → 200 alreadyMonitored
// 2) deduplicación de votos → 201 votes 1 y luego 2 (isDuplicateVote)
// 3) top popular público sin datos personales (Ley 81)
// 4) honeypot x-captcha-hp → 400 invalid_request
// Limpia SIEMPRE cualquier fila de prueba (finally).
// Ejecutar: bun scripts/verify-store-requests.ts
// ============================================================================
import { app } from "../src/app";
import { slugify } from "@regateo/shared";
import { db, inArray, storeRequests } from "@regateo/db";

const TEST_STORE = "Tienda Demo Test";
const TEST_KEY = "tienda-demo-test";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.log(`  ❌ ${name}`, detail ?? "");
  }
}

// Cada request simula un cliente distinto (el bucket es 8/min por IP) para que
// el rate limit no enmascare los checks de negocio.
let ipSeq = 0;
function nextClientIp(): string {
  ipSeq += 1;
  return `10.99.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
}

async function postStoreRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const res = await app.request("/api/store-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": nextClientIp(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

// Claves que la corrida podría crear por error: se borran siempre al final.
const cleanupKeys = new Set<string>([TEST_KEY, "otra-tienda-bot"]);
// Subconjunto que NUNCA debe llegar a existir (aliases de tiendas + bot).
const forbiddenKeys = new Set<string>(["otra-tienda-bot"]);
/** Registra una clave que debe borrarse y que nunca debería existir. */
function forgetKey(storeName: string): void {
  const key = slugify(storeName) || storeName.toLowerCase().trim();
  cleanupKeys.add(key);
  forbiddenKeys.add(key);
}
await db
  .delete(storeRequests)
  .where(inArray(storeRequests.normalizedKey, [...cleanupKeys]));

try {
  // 1) Tienda ya monitoreada por nombre -----------------------------------
  console.log("\n1) Tienda ya monitoreada (por nombre)");
  const monitored = await postStoreRequest({ storeName: "eVision Store" });
  check("status 200", monitored.status === 200, monitored);
  check("alreadyMonitored: true", monitored.body.alreadyMonitored === true, monitored.body);
  check(
    "nombre oficial en PANAMA_STORES",
    monitored.body.storeName === "eVision Store",
    monitored.body
  );

  // 1b) Tienda ya monitoreada por dominio sin protocolo --------------------
  console.log("\n1b) Tienda ya monitoreada (por dominio sin protocolo)");
  const byDomain = await postStoreRequest({
    storeName: "Multimax Online",
    websiteUrl: "multimax.net",
  });
  check("status 200", byDomain.status === 200, byDomain);
  check("alreadyMonitored: true", byDomain.body.alreadyMonitored === true, byDomain.body);
  check("resuelve a Multimax", byDomain.body.storeName === "Multimax", byDomain.body);

  // 1c) Aliases panameños de tiendas ya monitoreadas (Sprint 7: 13 tiendas) --
  console.log("\n1c) Aliases de las tiendas ya monitoreadas");
  const aliasCases: Array<{
    storeName: string;
    websiteUrl?: string;
    expected: string;
  }> = [
    { storeName: "Raenco", expected: "Raenco" },
    { storeName: "raenco.com", expected: "Raenco" },
    { storeName: "Play N Trade", expected: "PlayNTrade" },
    { storeName: "pnt panama", expected: "PlayNTrade" },
    { storeName: "Samsung Shop", expected: "Samsung Shop PA" },
    { storeName: "samsung panama", expected: "Samsung Shop PA" },
    { storeName: "LG Shop", expected: "LG Shop PA" },
    { storeName: "lgshop.com.pa", expected: "LG Shop PA" },
    { storeName: "evision", expected: "eVision Store" },
    { storeName: "Do it Center Panamá", expected: "Do it Center" },
    // Dominio explicito (tolera subdominios y paths largos)
    { storeName: "Tienda Oficial", websiteUrl: "raenco.com", expected: "Raenco" },
    {
      storeName: "Samsung Oficial",
      websiteUrl: "https://shop.samsung.com/latin/pa",
      expected: "Samsung Shop PA",
    },
  ];
  for (const alias of aliasCases) {
    forgetKey(alias.storeName);
    const res = await postStoreRequest({
      storeName: alias.storeName,
      ...(alias.websiteUrl ? { websiteUrl: alias.websiteUrl } : {}),
    });
    check(
      `"${alias.storeName}" → ${alias.expected}`,
      res.status === 200 &&
        res.body.alreadyMonitored === true &&
        res.body.storeName === alias.expected,
      res.body
    );
  }

  // 2) Tienda nueva → voto 1, luego voto duplicado → voto 2 ----------------
  console.log("\n2) Alta de sugerencia nueva + voto duplicado");
  const first = await postStoreRequest({
    storeName: TEST_STORE,
    websiteUrl: "tiendademotest.com",
    categoryHint: "Electrónica",
    details: "Prueba automatizada de sugerencias",
    contactEmail: "demo@regateo.test",
  });
  check("status 201", first.status === 201, first);
  check("alreadyMonitored: false", first.body.alreadyMonitored === false, first.body);
  check("isDuplicateVote: false", first.body.isDuplicateVote === false, first.body);
  check("votes: 1", first.body.request?.votes === 1, first.body.request);
  check(
    "websiteUrl normalizada con https://",
    first.body.request?.websiteUrl === "https://tiendademotest.com",
    first.body.request
  );

  const second = await postStoreRequest({ storeName: TEST_STORE });
  check("status 201 (segundo envío)", second.status === 201, second);
  check("isDuplicateVote: true", second.body.isDuplicateVote === true, second.body);
  check("votes: 2", second.body.request?.votes === 2, second.body.request);
  check(
    "conserva el websiteUrl del primer envío",
    second.body.request?.websiteUrl === "https://tiendademotest.com",
    second.body.request
  );

  // 3) Top popular: público y sin datos personales ------------------------
  console.log("\n3) GET /api/store-requests/popular");
  const popularRes = await app.request("/api/store-requests/popular");
  const popularRaw = await popularRes.text();
  const popular = JSON.parse(popularRaw) as any;
  check("status 200", popularRes.status === 200, popularRaw);
  check("items es array", Array.isArray(popular.items), popular);
  check("meta.cached presente", typeof popular.meta?.cached === "boolean", popular.meta);
  check(
    "incluye la sugerencia de prueba",
    popular.items.some((item: any) => item.normalizedKey === TEST_KEY),
    popular.items
  );
  check(
    "NUNCA expone contactEmail ni details",
    !popularRaw.includes("contactEmail") &&
      !popularRaw.includes("demo@regateo.test") &&
      !popularRaw.includes("details"),
    popularRaw
  );

  // 4) Honeypot ------------------------------------------------------------
  console.log("\n4) Honeypot x-captcha-hp");
  const honeypot = await postStoreRequest(
    { storeName: "Otra Tienda Bot" },
    { "x-captcha-hp": "bot-field-filled" }
  );
  check("status 400", honeypot.status === 400, honeypot);
  check(
    'error "invalid_request"',
    honeypot.body.error === "invalid_request",
    honeypot.body
  );
  const bots = await db
    .select({ id: storeRequests.id, normalizedKey: storeRequests.normalizedKey })
    .from(storeRequests)
    .where(inArray(storeRequests.normalizedKey, [...forbiddenKeys]));
  check(
    "ningún alias ni bot creó filas",
    bots.length === 0,
    bots.map((row) => row.normalizedKey)
  );

  // 5) Analítica interna: conteo y top de sugerencias ---------------------
  console.log("\n5) Analítica interna");
  const analyticsRes = await app.request("/api/admin/analytics?days=30", {
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  if (analyticsRes.status === 200) {
    const analytics = (await analyticsRes.json()) as any;
    check(
      "openStoreRequestsCount ≥ 1",
      (analytics.openStoreRequestsCount ?? 0) >= 1,
      analytics.openStoreRequestsCount
    );
    check(
      "topStoreRequests incluye la sugerencia de prueba",
      Array.isArray(analytics.topStoreRequests) &&
        analytics.topStoreRequests.some(
          (item: any) => item.storeName === TEST_STORE && item.votes === 2
        ),
      analytics.topStoreRequests
    );
  } else {
    console.log("  ⚠️  CRON_SECRET no configurado: se omite la verificación de analítica.");
  }
} finally {
  // Limpieza obligatoria: la BD queda como estaba (incluye cualquier alias que
  // por una regresión se haya guardado como sugerencia nueva).
  await db
    .delete(storeRequests)
    .where(inArray(storeRequests.normalizedKey, [...cleanupKeys]));
  const leftovers = await db
    .select({ id: storeRequests.id })
    .from(storeRequests)
    .where(inArray(storeRequests.normalizedKey, [...cleanupKeys]));
  console.log(
    `\nLimpieza: fila "${TEST_STORE}" y alias de tiendas eliminados (restantes: ${leftovers.length})`
  );
  console.log(failures === 0 ? "\n✅ Todo OK" : `\n❌ ${failures} fallo(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
