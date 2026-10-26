/* Watch Party service worker. It exists so Chrome offers "Install app" (the install prompt needs a fetch handler).
   It caches nothing: page loads go straight to the network, and every other request (videos, Drive, league data)
   is left alone, so updates still arrive through version.json and the "Reload now" banner. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
