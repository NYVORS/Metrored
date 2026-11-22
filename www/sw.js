const CACHE = 'metrored-shell-v9';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icon.png', './metrored.webmanifest'];
// Librerias externas necesarias para que el mapa abra sin internet (se guardan al primer uso).
const CDN = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await Promise.all(CDN.map(u => fetch(u).then(r => r.ok && cache.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('metrored-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN.includes(req.url)) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
      return res;
    } catch (e) {
      return (await caches.match(req)) || (sameOrigin ? await caches.match('./index.html') : Response.error());
    }
  })());
});
