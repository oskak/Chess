/**
 * Service worker: makes the app installable and usable offline.
 *
 * Strategy: NETWORK FIRST for everything (same origin). When online you always
 * get the latest version straight from the server — no "old version stuck in
 * the cache" problems. Every successful response is also stored, so when
 * offline the last version you used still loads (including Stockfish once it
 * has been used online).
 */
const CACHE = 'crt-cache-v1';

// Small app shell, cached on install so the app opens offline right away.
const CORE = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/app.css',
    'vendor/jquery-3.7.1.min.js',
    'vendor/chessboard-1.0.0.min.css',
    'vendor/chessboard-1.0.0.min.js',
    'vendor/chess.min.js',
    'js/move-tree.js',
    'js/pgn-parser.js',
    'js/db.js',
    'js/trainer.js',
    'js/sounds.js',
    'js/pieces.js',
    'js/dialogs.js',
    'js/board-overlay.js',
    'js/eco.js',
    'js/engine.js',
    'js/sample-repertoires.js',
    'js/app.js',
    'icons/icon-192.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(CORE))
            .catch(err => console.warn('[sw] precache failed:', err))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() =>
                caches.match(req, { ignoreSearch: true }).then(cached => {
                    if (cached) return cached;
                    if (req.mode === 'navigate') return caches.match('index.html');
                    return Response.error();
                })
            )
    );
});
