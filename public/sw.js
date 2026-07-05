// NestUs service worker — network-first (always fresh online), cache fallback offline.
const CACHE = 'nestus-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/icon-192.png', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin GETs; never the API (keep data fresh) or cross-origin (Supabase, map tiles, GA).
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(req).then(c => c || caches.match('/')))
  );
});
