const CACHE = 'shy2speak-app-v47';
const APP_SHELL = ['./', './index.html', './boot.js?v=47', './styles.css?v=47', './runtime-config.js?v=47', './i18n.js?v=47', './backend.js?v=47', './app.js?v=47', './data/catalog.json?v=47', './data/vocabulary.json?v=47', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.endsWith('/runtime-config.js')) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  if (event.request.mode === 'navigate' || /\/(?:boot|i18n|backend|app)\.js$|\/styles\.css$/.test(url.pathname)) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
