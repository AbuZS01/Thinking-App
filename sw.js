/* Master Thinking Coach — service worker.
   Stale-while-revalidate: serve from cache instantly (works offline), refresh
   the cache in the background so the next load picks up updates.
   Bump CACHE_VERSION whenever shipped files change. */

const CACHE_VERSION = "mtc-v1";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./content.js",
  "./engine.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(event.request, { ignoreSearch: event.request.mode === "navigate" }).then((cached) => {
        const refresh = fetch(event.request)
          .then((resp) => {
            if (resp && resp.ok) cache.put(event.request, resp.clone());
            return resp;
          })
          .catch(() => cached || (event.request.mode === "navigate" ? cache.match("./index.html") : undefined));
        return cached || refresh;
      })
    )
  );
});
