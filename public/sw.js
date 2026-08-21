// Kill-switch service worker: unregisters any previously installed PWA SW
// and clears its caches without navigating or reloading open application tabs.
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.registration.unregister();
    })()
  )
);
