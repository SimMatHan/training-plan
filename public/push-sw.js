// Indlæses i service workeren (vite.config.ts → workbox.importScripts). Push-beskederne fra serveren
// er tomme; teksten står her. iOS kræver, at hver push viser en notifikation.
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Husk mobilitet', {
      body: 'God morgen! Tag yoga + core i dag.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'mobilitet',
      data: { url: '/' },
    }),
  );
});

// Tryk på notifikationen: åbn appen på "I dag" (eller fokusér den, hvis den allerede er åben).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      const open = all.find((c) => 'focus' in c);
      // navigate kan afvises for et vindue, service workeren ikke styrer; så fokuseres det bare.
      if (open) return open.focus().then((c) => c.navigate(url).catch(() => c));
      return self.clients.openWindow(url);
    }),
  );
});
