/*
 * Moonsling service worker: caches the game so the home-screen app works offline.
 * Stale-while-revalidate: launches instantly from cache, picks up updates next launch.
 */
const CACHE = 'moonsling-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'js/core.js',
  'js/render.js',
  'js/audio.js',
  'js/share.js',
  'js/main.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Other games hosted in sub-folders (e.g. /critter-merge/) look after themselves.
  if (url.pathname.startsWith(new URL('critter-merge/', self.registration.scope).pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
