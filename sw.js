const CACHE_NAME = 'appuntamenti-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
  return self.clients.claim();
});

// Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 🔴 IMPORTANTE: NON intercettare mai le richieste a Supabase
  if (url.hostname.includes('supabase.co')) {
    return; // va direttamente in rete, mai in cache
  }

  // Per gli asset statici: cache-first
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(response => {
          // Cache della risposta per future richieste
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        // Fallback per richieste offline
        return caches.match('/');
      })
  );
});