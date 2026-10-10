const CACHE = 'empro-ironworker-v5';
// Relative to this script. On Pages that directory is /Ironworker/, not the host root.
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/calc.js', 'js/data.js', 'js/tooling.js', 'js/store.js',
  'data/materials.json', 'data/tooling.json', 'data/sizes.json', 'data/machines.json',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
// Network-first (so data updates show up), fall back to cache when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
