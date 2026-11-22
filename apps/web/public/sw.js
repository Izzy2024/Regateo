/* Regateo Service Worker — shell estático ligero y seguro.
 *
 * Regla de oro de precios honestos: NUNCA cacheamos respuestas de `/api/`
 * ni redirects de `/out/`; siempre van network-only para que el usuario
 * jamás vea un precio viejo.
 */
const CACHE_NAME = "regateo-shell-v2";
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.png",
  "/logo-mark.webp",
  "/mascota-hero.webp",
];
const NEVER_CACHE = [/^\/api\//, /^\/out\//];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Precios y clics medidos: siempre red, sin cache ni fallback.
  if (NEVER_CACHE.some((pattern) => pattern.test(url.pathname))) return;

  // Navegación: network-first con fallback al shell cacheado (offline limpio).
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  // Shell estático: cache-first.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
});
