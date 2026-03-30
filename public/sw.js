// Service Worker - 푸시 알림 수신

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('push', e => {
  let data = { title: '📊 RSI 투자 알림', body: '포트폴리오를 확인하세요' };
  try {
    data = e.data.json();
  } catch {}

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: '/' },
    actions: [
      { action: 'open', title: '확인하기' }
    ]
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      if (list.length > 0) {
        return list[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});
