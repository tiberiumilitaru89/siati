// @ts-check
// v3: fonturile sunt acum locale (/_astro/*.woff2, servite cache-first de mai jos), fără nicio cerere către terți.
// La activare se șterg:
//  - v1, care putea păstra HTML-ul panoului /admin (comenzi, date clienți) în browserul administratorului;
//  - v2, ale cărui pagini în cache încă trimiteau către vechea sursă externă de fonturi.
const CACHE_NAME = 'siati-cache-v3';
const STATIC_ASSETS = [
  '/',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/images/tulip_hero.webp',
  '/images/tulip_hero-mobile.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    )
  );
  self.clients.claim();
});

/**
 * Un răspuns poate fi păstrat în cache doar dacă este reușit și nu este marcat explicit ca privat.
 * @param {Response} response
 */
function isCacheable(response) {
  const cacheControl = response.headers.get('Cache-Control') || '';
  return response.status === 200 && !/no-store|private/i.test(cacheControl);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1) Nu intermediem NICIODATĂ cereri către alte origini (Supabase Storage, Stripe etc.).
  //    O cerere refăcută de service worker este supusă `connect-src` din CSP-ul worker-ului și ar fi blocată
  //    (așa dispăreau fonturile externe la vizitele repetate, înainte ca fonturile să devină locale).
  if (url.origin !== self.location.origin) {
    return;
  }

  // 2) Nu intermediem mutații, API-uri și panoul de administrare (conține comenzi și date de clienți).
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/admin' ||
    url.pathname.startsWith('/admin/')
  ) {
    return;
  }

  // Cache-First strategy for static images, icons, fonts
  if (
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (isCacheable(networkResponse)) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Network-First with Cache fallback for HTML pages
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (isCacheable(networkResponse)) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const fallback = await caches.match('/');
        if (fallback) return fallback;
        return new Response('Florăria Siati este momentan indisponibilă offline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
