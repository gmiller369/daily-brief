/* Service worker: app shell works offline; brief data is network-first with an offline fallback. */
const SHELL_CACHE = 'brief-shell-v1';
const DATA_CACHE = 'brief-data-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'crypto.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isData = /\/(data|demo)\//.test(url.pathname);
  if (isData) {
    // Network first so the brief is always fresh; fall back to last saved copy offline.
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA_CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match(e.request).then((r) => r || new Response('null', { status: 404 })))
    );
    return;
  }
  // App shell: network first too (so updates land quickly), cache fallback offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
