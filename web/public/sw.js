// Tessel service worker: the app opens with no signal, and boards load from the device (IndexedDB) until the network is back.
const CACHE = 'tessel-v1';
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE.href, new URL('manifest.webmanifest', SCOPE).href, new URL('icon-192.png', SCOPE).href])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // only our own files; the API, sockets, uploads and anything else go straight to the network
  if (req.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (req.mode === 'navigate') {
    // pages: always try for the newest version, fall back to the saved app when offline
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SCOPE.href, copy)); }
        return res.ok ? res : caches.match(SCOPE.href).then((r) => r || res);
      }).catch(() => caches.match(SCOPE.href)),
    );
    return;
  }

  // built files have a content hash in their name, so a saved copy is always right
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.includes('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname))) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
