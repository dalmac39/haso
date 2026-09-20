/* ============================================================
   DALMAC PS4 13.52 — Service Worker
   Cache-first strategy for full offline support.
   ============================================================ */

var CACHE_NAME = 'DALMAC_PS4_13_52_v3';

var ASSETS_TO_CACHE = [
  './',
  'index.html',
  'jb.html',
  'styles.css',
  'styles.css?v=2',
  'app.js',
  'manifest.json',

  /* Exploit engine (cached, never modified) */
  'core.js',
  'core.js?v=10',
  'mem.js',
  'int64.js',
  'jb.js',
  'jb.js?v=10',
  'ps4_offsets.js',
  'rpc_worker.js',

  /* Payloads & patches */
  'payload2.bin',
  'goldhen.bin',
  'patches/1302.bin',
  'patches/1350.bin',
  'patches/1352.bin',

  /* DALMAC branding */
  'assets/branding/dalmac-logo.jpg',
  'assets/background/dalmac-background.png'
];

/* ---- Install: Pre-cache all assets ---- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---- Activate: Clean old caches ---- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---- Fetch: Network-first for web code, Cache-first for binaries ---- */
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = event.request.url;
  var isCode = url.indexOf('.html') !== -1 ||
               url.indexOf('.css') !== -1 ||
               url.indexOf('.js') !== -1 ||
               event.request.mode === 'navigate';

  if (isCode) {
    /* Try network first to get latest UI, fallback to cache offline */
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  /* Cache-first for heavy binaries and images */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;

      return fetch(event.request).then(function (response) {
        if (!response || response.status !== 200) {
          return response;
        }

        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, clone);
        });

        return response;
      });
    })
  );
});
