/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// App shell, scene chunk, font and icons are precached at install: the app opens offline.
precacheAndRoute(self.__WB_MANIFEST);
// Deep links (/join/CODE …) are client routes.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/sandbox/] }));

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') void self.skipWaiting();
});

interface PushPayload {
  title: string;
  body: string;
  /** Groups notifications so a burst replaces rather than stacks. */
  tag?: string;
  url?: string;
}

self.addEventListener('push', (e) => {
  const data = (e.data?.json() ?? {}) as Partial<PushPayload>;
  e.waitUntil(
    self.registration.showNotification(data.title ?? '저승 커피 채권관리공사', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag ?? 'ledger',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data as { url?: string } | undefined)?.url ?? '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => new URL(c.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
