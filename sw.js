// sw.js
const SHELL_CACHE = "luxroute-shell-v2"; // <- підняв версію, щоб точно оновилось
const TILE_CACHE  = "luxroute-tiles-v1";

const SHELL_ASSETS = [
  "./",
  "./dpd_map.html",
  "./leaflet.css",
  "./leaflet.js",
  "./leaflet-rotate-src.js",
  "./telegram-web-app.js",
  "./lz-string.min.js",
  "./sw.js"
];

const MAX_TILES = 250;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // прибираємо старі shell-кеші
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k.startsWith("luxroute-shell-") && k !== SHELL_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

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

  // 0) Навігація (відкриття сторінки) — даємо офлайн fallback
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cached = await caches.match("./dpd_map.html");
      try {
        return await fetch(req);
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // 1) App shell — cache-first
  const isShellAsset =
    url.origin === self.location.origin &&
    (
      url.pathname.endsWith("/dpd_map.html") ||
      url.pathname.endsWith("/leaflet.css") ||
      url.pathname.endsWith("/leaflet.js") ||
      url.pathname.endsWith("/leaflet-rotate-src.js") ||
      url.pathname.endsWith("/telegram-web-app.js")
    );

  if (isShellAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const resp = await fetch(req);
      const copy = resp.clone();
      caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
      return resp;
    })());
    return;
  }

  // 2) OSM tiles — stale-while-revalidate
  const isOsmTile = url.hostname === "tile.openstreetmap.org";
  if (isOsmTile) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then((resp) => {
        if (resp && resp.ok) {
          cache.put(req, resp.clone()).then(trimTileCache);
        }
        return resp;
      }).catch(() => cached);

      return cached || fetchPromise;
    })());
    return;
  }

  // інше — браузер сам
});