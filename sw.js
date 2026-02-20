// sw.js
const SHELL_CACHE = "luxroute-shell-v1";
const TILE_CACHE  = "luxroute-tiles-v1";

const SHELL_ASSETS = [
  "./",            // щоб корінь працював
  "./dpd_map.html",
  "./leaflet.css",
  "./leaflet.js"
];

// простий ліміт на тайли (щоб не роздувати сховище)
const MAX_TILES = 250;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// helper: обрізати кеш тайлів до MAX_TILES
async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  const extra = keys.length - MAX_TILES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "CLEAR_TILES") {
    event.waitUntil(caches.delete(TILE_CACHE));
  }
  if (msg.type === "CLEAR_ALL") {
    event.waitUntil(Promise.all([caches.delete(TILE_CACHE), caches.delete(SHELL_CACHE)]));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) App shell — cache-first (відкривається офлайн)
  const isShellAsset =
    url.pathname.endsWith("/dpd_map.html") ||
    url.pathname.endsWith("/leaflet.css") ||
    url.pathname.endsWith("/leaflet.js") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/");

  if (isShellAsset) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        return resp;
      }))
    );
    return;
  }

  // 2) OSM tiles — stale-while-revalidate (але без масового prefetch)
  const isOsmTile = url.hostname === "tile.openstreetmap.org";
  if (isOsmTile) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then((resp) => {
        // кешуємо тільки успішні тайли
        if (resp && resp.ok) {
          cache.put(req, resp.clone()).then(trimTileCache);
        }
        return resp;
      }).catch(() => cached); // якщо офлайн — віддамо кеш

      return cached || fetchPromise;
    })());
    return;
  }

  // інше — як є
});
