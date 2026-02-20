// sw.js

const SHELL_CACHE = "luxroute-shell-v4"; // підніми версію якщо ще раз будеш міняти shell
const TILE_CACHE = "luxroute-tiles-v1";

// базовий шлях, де лежить sw.js (наприклад: /dpd-map/)
const BASE = new URL(self.registration.scope).pathname;

// файли “оболонки”, які мають відкриватися офлайн
const SHELL_ASSETS = [
  BASE + "dpd_map.html",
  BASE + "leaflet.css",
  BASE + "leaflet.js",
  BASE + "leaflet-rotate-src.js",
  BASE + "telegram-web-app.js",
  BASE + "lz-string.min.js",
  BASE + "sw.js",
];

// простий ліміт на тайли (щоб не роздувати сховище)
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
      if (k.startsWith("luxroute-shell-") && k !== SHELL_CACHE) {
        return caches.delete(k);
      }
    }));
    await self.clients.claim();
  })());
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
    event.waitUntil(Promise.all([
      caches.delete(TILE_CACHE),
      caches.delete(SHELL_CACHE)
    ]));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 0) Навігація (відкриття сторінки) — офлайн fallback
  // ВАЖЛИВО: ignoreSearch, щоб /dpd_map.html?rk=... знаходилось як /dpd_map.html
  if (req.mode === "navigate") {
    event.respondWith((async () => {

      const cached =
        await caches.match(req, { ignoreSearch: true }) ||
        await caches.match(BASE + "dpd_map.html", { ignoreSearch: true });

      // якщо офлайн — навіть не пробуємо fetch
      if (!navigator.onLine) {
        return cached || Response.error();
      }

      try {
        const networkResp = await fetch(req);
        return networkResp;
      } catch (e) {
        return cached || Response.error();
      }

    })());
    return;
  }

  // 1) App shell — cache-first (локальні файли)
  const isShellAsset =
    url.origin === self.location.origin &&
    (
      url.pathname.endsWith("/dpd_map.html") ||
      url.pathname.endsWith("/leaflet.css") ||
      url.pathname.endsWith("/leaflet.js") ||
      url.pathname.endsWith("/leaflet-rotate-src.js") ||
      url.pathname.endsWith("/telegram-web-app.js") ||
      url.pathname.endsWith("/lz-string.min.js") ||
      url.pathname.endsWith("/sw.js")
    );

  if (isShellAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;

      const resp = await fetch(req);
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
      }
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

  // 3) Інше — як є (браузер)
});