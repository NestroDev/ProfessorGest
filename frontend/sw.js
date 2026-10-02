const CACHE_NAME = 'professorgest-shell-v70-palette';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './legal.css',
  './app.js',
  './api-config.js',
  './src/prof-model.js',
  './src/grade-recommendation.js',
  './src/project-store.js',
  './src/prg-transfer.js',
  './src/drive-sync.js',
  './src/ded-project.js',
  './src/drive-account.js',
  './src/file-io.js',
  './src/drive-http.js',
  './src/project-selectors.js',
  './src/ui-navigation.js',
  './src/ui-modal.js',
  './src/ui-search.js',
  './src/save-state.js',
  './src/views-core.js',
  './src/views-students-activities.js',
  './src/views-calendar-occurrences.js',
  './src/views-reports.js',
  './src/views-class.js',
  './src/views-file-settings.js',
  './src/views-projects.js',
  './src/views-planning.js',
  './src/services/api-client.js',
  './src/ded-parser.js',
  './src/ded-pdf.js',
  './vendor/pdfjs/pdf.mjs',
  './vendor/pdfjs/pdf.worker.mjs',
  './google-drive-config.js',
  './logo.svg?v=25',
  './manifest.webmanifest?v=25',
  './icon-192.png?v=25',
  './icon-512.png?v=25',
  './icon-512-maskable.png?v=25',
  './privacidade.html',
  './termos.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('professorgest-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackPath = null) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
    return (await cache.match(request)) || (fallbackPath ? await cache.match(fallbackPath) : null) || response;
  } catch (_) {
    return (await cache.match(request)) || (fallbackPath ? await cache.match(fallbackPath) : null) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}


self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // Recursos mutáveis do aplicativo usam rede primeiro. Isso evita que uma
  // versão antiga do JS/CSS fique presa no aparelho após uma publicação.
  if (
    request.destination === 'image' && url.pathname.endsWith('/logo.svg')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'document' ||
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/google-drive-config.js')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
