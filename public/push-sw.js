// Push notification service worker
self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Banana Calçados';
  const options = {
    body: data.body || '',
    icon: '/images/banana-logo.png',
    badge: '/images/banana-logo.png',
    image: data.image || undefined,
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: data.url ? [{ action: 'open', title: 'Abrir' }] : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(clients.openWindow(url));
});
