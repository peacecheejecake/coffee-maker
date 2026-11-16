/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// App shell, scene chunk, font and icons are precached at install: the app opens offline.
precacheAndRoute(self.__WB_MANIFEST);
// Deep links (/join/CODE …) are client routes.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/sandbox/] }));

// A new version waits until the page says it is a good moment (swUpdate.ts), then takes over. workbox-window
// sends { type: 'SKIP_WAITING' }; the bare string is kept for pages still running an older registration.
// Not skipping on install by itself: an old page could then ask for lazy chunks the new deploy no longer has.
self.addEventListener('message', (e) => {
  const data = e.data as unknown;
  if (data === 'SKIP_WAITING' || (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'SKIP_WAITING')) {
    void self.skipWaiting();
  }
});

// One-off move off the first generation of workers. Pages from before swUpdate.ts never ask a waiting worker
// to take over, so this generation takes over by itself once and reloads the windows the old one served.
// Later updates find the marker cache and wait for the page as above.
const GENERATION = 'coffee-sw-generation-2';
const REPLACING = 'coffee-sw-replacing-gen1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      if (await caches.has(GENERATION)) return;
      // Remembered across a worker restart between install and activate.
      if (self.registration.active) await caches.open(REPLACING);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  const takeOver = (async () => {
    await caches.open(GENERATION);
    if (!(await caches.delete(REPLACING))) return [];
    await self.clients.claim();
    return self.clients.matchAll({ type: 'window' });
  })();
  e.waitUntil(takeOver);
  // Reload only after activation is over: the reload's own request waits for it, so awaiting it in there deadlocks.
  void takeOver.then((windows) => Promise.all(windows.map((c) => c.navigate(c.url).catch(() => null))));
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
