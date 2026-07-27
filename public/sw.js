/* Hosted-preview service-worker kill switch.
   The real offline PWA build is generated only outside GitHub Pages. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await self.registration.unregister();

    for (const client of windows) {
      const url = new URL(client.url);
      url.searchParams.set('sw-reset', Date.now().toString());
      await client.navigate(url.toString());
    }
  })());
});
