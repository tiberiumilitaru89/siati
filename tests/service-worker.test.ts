import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://floraria-siati.ro';

type Listener = (event: unknown) => void;

function loadWorker(networkResponse: () => Response = () => new Response('<html></html>', { status: 200 })) {
  const listeners = new Map<string, Listener>();
  const put = vi.fn(async () => undefined);
  const cache = { addAll: vi.fn(async () => undefined), put };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => ['siati-cache-v1', 'siati-cache-v2', 'siati-cache-v3']),
    delete: vi.fn(async () => true),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const fetchMock = vi.fn(async () => networkResponse());
  new Function('self', 'caches', 'fetch', 'URL', 'Response', source)(self, caches, fetchMock, URL, Response);
  return { listeners, caches, put, fetchMock };
}

type Worker = ReturnType<typeof loadWorker>;

function dispatchFetch(worker: Worker, url: string, method = 'GET') {
  const respondWith = vi.fn();
  worker.listeners.get('fetch')?.({ request: new Request(url, { method }), respondWith });
  return respondWith;
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('service worker — nu intermediază origini străine (bug: fonturile dispăreau la a doua vizită)', () => {
  it.each([
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600',
    'https://fonts.gstatic.com/s/cormorantgaramond/v21/font.woff2',
    'https://images.unsplash.com/photo-1520763185298-1b434c919102',
    'https://js.stripe.com/v3/',
  ])('lasă browserul să ceară direct %s', (url) => {
    expect(dispatchFetch(loadWorker(), url)).not.toHaveBeenCalled();
  });
});

describe('service worker — date sensibile și mutații', () => {
  it.each(['/admin', '/admin/', '/admin/orders', '/api/admin/auth', '/api/webhooks/stripe'])(
    'nu intermediază %s',
    (path) => {
      expect(dispatchFetch(loadWorker(), `${ORIGIN}${path}`)).not.toHaveBeenCalled();
    }
  );

  it('nu intermediază cereri non-GET', () => {
    expect(dispatchFetch(loadWorker(), `${ORIGIN}/`, 'POST')).not.toHaveBeenCalled();
  });

  it('nu păstrează în cache răspunsurile marcate privat / no-store', async () => {
    const worker = loadWorker(() => new Response('privat', { status: 200, headers: { 'Cache-Control': 'private, no-store' } }));
    const respondWith = dispatchFetch(worker, `${ORIGIN}/ceva`);
    await respondWith.mock.calls[0]?.[0];
    await nextTick();
    expect(worker.put).not.toHaveBeenCalled();
  });
});

describe('service worker — comportamentul util rămâne', () => {
  it.each(['/', '/politica-livrare/', '/images/tulip_hero.webp', '/icons/icon-192.png'])(
    'intermediază %s de pe aceeași origine',
    (path) => {
      expect(dispatchFetch(loadWorker(), `${ORIGIN}${path}`)).toHaveBeenCalledTimes(1);
    }
  );

  it('păstrează în cache paginile obișnuite', async () => {
    const worker = loadWorker();
    const respondWith = dispatchFetch(worker, `${ORIGIN}/politica-livrare/`);
    await respondWith.mock.calls[0]?.[0];
    await nextTick();
    expect(worker.put).toHaveBeenCalledTimes(1);
  });

  it('la activare șterge v1 (putea conține HTML-ul /admin) și v2 (pagini care trimiteau către fonturi externe) și îl păstrează pe v3', async () => {
    const worker = loadWorker();
    const waitUntil = vi.fn();
    worker.listeners.get('activate')?.({ waitUntil });
    await waitUntil.mock.calls[0]?.[0];
    expect(worker.caches.delete).toHaveBeenCalledWith('siati-cache-v1');
    expect(worker.caches.delete).toHaveBeenCalledWith('siati-cache-v2');
    expect(worker.caches.delete).not.toHaveBeenCalledWith('siati-cache-v3');
  });
});

describe('service worker — fonturi locale', () => {
  const fontPath = '/_astro/cormorant-garamond-latin-700-normal.Ab12Cd34.woff2';

  it('servește fonturile locale (woff2) cache-first, de pe aceeași origine', () => {
    expect(dispatchFetch(loadWorker(), `${ORIGIN}${fontPath}`)).toHaveBeenCalledTimes(1);
  });

  it('păstrează un font local în cache după prima descărcare reușită', async () => {
    const worker = loadWorker(() => new Response('woff2', { status: 200, headers: { 'Content-Type': 'font/woff2' } }));
    const respondWith = dispatchFetch(worker, `${ORIGIN}${fontPath}`);
    await respondWith.mock.calls[0]?.[0];
    await nextTick();
    expect(worker.put).toHaveBeenCalledTimes(1);
  });

  it('nu mai conține nicio referință către un furnizor extern de fonturi', () => {
    expect(source).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });
});
