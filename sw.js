const CACHE_NAME = 'nextapp-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Non intercettare le chiamate a Supabase: devono sempre andare in rete
  if(url.hostname.includes('supabase.co')) return;

  // Richieste di navigazione (HTML) e index.html: sempre rete prima,
  // così l'app si aggiorna subito ad ogni deploy. Cache solo come fallback offline.
  const isHtml = event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');
  if(isHtml){
    event.respondWith(
      fetch(event.request).then(resp => {
        if(resp.status === 200){
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
        }
        return resp;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Altri asset statici: cache-first per velocità/offline
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(resp => {
        if(event.request.method === 'GET' && resp.status === 200){
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
