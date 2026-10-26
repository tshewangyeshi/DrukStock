// Service worker (eng D24). scripts/build.mjs fills in the cache name and
// the asset list. Install precaches every asset of both variants and only
// then marks the cache complete; the start screen shows "Offline ready"
// only when that marker exists for the running build.

const CACHE = '__CACHE__';
const ASSETS = __ASSETS__;
const COMPLETE = './__precache-complete__';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await cache.put(COMPLETE, new Response(CACHE));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('drukstock-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Cache first: the demo must work with no signal. Everything it needs is precached.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request, { ignoreSearch: true });
    return hit ?? fetch(event.request);
  })());
});
