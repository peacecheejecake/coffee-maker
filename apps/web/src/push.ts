import type { PushPort, PushSubscriptionData } from '@coffee/app';

const base64ToBytes = (b64: string) => {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/**
 * Push API via the app's service worker (registered in production builds only).
 * iOS delivers web push only to installed (home-screen) PWAs.
 */
export function createBrowserPush(vapidPublicKey: string | undefined): PushPort {
  const supported = () =>
    !!vapidPublicKey &&
    import.meta.env.PROD &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window;
  const registration = () => navigator.serviceWorker.ready;

  return {
    supported,
    permission: () => (supported() ? Notification.permission : 'unsupported'),
    async subscribe() {
      if (!supported()) return null;
      if ((await Notification.requestPermission()) !== 'granted') return null;
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(vapidPublicKey!) }));
      return sub.toJSON() as PushSubscriptionData;
    },
    async unsubscribe() {
      if (!supported()) return null;
      const sub = await (await registration()).pushManager.getSubscription();
      if (!sub) return null;
      await sub.unsubscribe();
      return sub.endpoint;
    },
    async current() {
      if (!supported()) return null;
      return (await (await registration()).pushManager.getSubscription())?.endpoint ?? null;
    },
  };
}
