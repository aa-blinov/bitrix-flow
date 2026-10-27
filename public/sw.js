// Service worker только для пушей о сообщениях: кэша и офлайн-режима здесь нет намеренно,
// иначе после выкладки пользователи сидели бы на старой версии приложения.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'BitrixFlow', {
      body: data.body || '',
      tag: data.tag,
      data: { url: data.url || '/messenger' },
      // Упоминание висит, пока его не закроют: обычное сообщение исчезает само.
      requireInteraction: Boolean(data.urgent),
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/messenger', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((client) => client && client.focus());
      return self.clients.openWindow(url);
    }),
  );
});
