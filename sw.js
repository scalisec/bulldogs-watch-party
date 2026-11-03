/* Watch Party service worker (v2.7: offline mode).
   Keeps a copy of the app's own files so Watch Party opens with no internet (e.g. on the train).
   Online, every app file still comes from the network first, so updates arrive as before (version.json and the
   "Reload now" banner); the copy is only used when the network doesn't answer.
   Everything else (videos, Google, Drive, league data, fonts) is left alone. */
const VERSION = '2.7.0';
const CACHE = 'wp-app-' + VERSION;
const FILES = [
  './', 'index.html', 'shortcuts.html', 'styles.css', 'manifest.webmanifest',
  'config.js', 'core.js', 'storage.js', 'render.js', 'audio.js', 'drive.js',
  'vendor/mp4-muxer.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'app/base.js', 'app/diag.js', 'app/player.js', 'app/lineup.js', 'app/league.js', 'app/games.js', 'app/tag.js',
  'app/editor.js', 'app/record.js', 'app/export.js', 'app/settings.js', 'app/team.js', 'app/team-sync.js',
  'app/library.js', 'app/review.js', 'app/summary.js', 'app/gamesheet.js', 'app/teams.js', 'app/main.js',
  'icons/favicon.svg', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'
];
const SCOPE = new URL('./', self.location).href;
const NETWORK_WAIT = 4000; // a train's "connected but nothing arrives": give up on the network after this

const plain = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(FILES.map((f) => {
      const url = new URL(f, SCOPE).href;
      const key = url.endsWith('/') ? new URL('index.html', SCOPE).href : url;
      return fetch(new Request(url, { cache: 'reload' })).then((r) => (r.ok ? c.put(key, r) : null)).catch(() => null);
    })))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('wp-app-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function appFile(req) {
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return false;
  const path = new URL(req.url).pathname;
  return !/version\.json$/.test(path); // always asked fresh: it's how the app notices an update
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (!appFile(req)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = plain(req.url).endsWith('/') ? plain(new URL('index.html', SCOPE).href) : plain(req.url);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), NETWORK_WAIT))
      ]);
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
