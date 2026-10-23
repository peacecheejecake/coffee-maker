import type { PushPort } from '@coffee/app';
import type { Platform } from '@coffee/ui';
import { Capacitor } from '@capacitor/core';

/** True inside the iOS/Android shell (apps/mobile). */
export const isNative = () => Capacitor.isNativePlatform();

const REMINDER_ID = 850;

/** Platform port backed by Capacitor plugins; loaded only in the native shell. */
export async function createNativePlatform(): Promise<Platform> {
  const [{ Haptics, ImpactStyle }, { Share }, { Camera, CameraResultType, CameraSource }, { LocalNotifications }, { Filesystem, Directory }] =
    await Promise.all([
      import('@capacitor/haptics'),
      import('@capacitor/share'),
      import('@capacitor/camera'),
      import('@capacitor/local-notifications'),
      import('@capacitor/filesystem'),
    ]);

  const style = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy } as const;

  /** Native share sheets take file URIs, not blobs: write to the cache directory first. */
  const toUri = async (file: File) => {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const { uri } = await Filesystem.writeFile({ path: file.name, data, directory: Directory.Cache });
    return uri;
  };

  return {
    haptic: (strength) => void Haptics.impact({ style: style[strength] }),
    canShare: () => true,
    async share(data) {
      try {
        const files = data.files?.length ? await Promise.all(data.files.map(toUri)) : undefined;
        await Share.share({
          ...(data.title && { title: data.title }),
          ...(data.text && { text: data.text }),
          ...(data.url && { url: data.url }),
          ...(files && { files }),
        });
        return true;
      } catch {
        return false;
      }
    },
    async pickPhoto() {
      try {
        const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Prompt, quality: 80 });
        return photo.webPath ? await (await fetch(photo.webPath)).blob() : null;
      } catch {
        return null; // cancelled
      }
    },
    reminder: {
      async enabled() {
        const { notifications } = await LocalNotifications.getPending();
        return notifications.some((n) => n.id === REMINDER_ID);
      },
      async set(on, at, text) {
        await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
        if (!on) return false;
        if ((await LocalNotifications.requestPermissions()).display !== 'granted') return false;
        const [hour, minute] = at.split(':').map(Number);
        await LocalNotifications.schedule({
          notifications: [
            { id: REMINDER_ID, title: text.title, body: text.body, schedule: { on: { hour: hour!, minute: minute! }, allowWhileIdle: true } },
          ],
        });
        return true;
      },
    },
  };
}

/**
 * Native chrome: status bar over the dark stage, splash hidden once React has painted, and deep links
 * (coffeemaker://join/CODE or https://…/join/CODE universal links) routed into the app.
 */
export async function initNativeShell(navigate: (path: string) => void) {
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  void App.addListener('appUrlOpen', ({ url }) => {
    const parsed = new URL(url);
    // Custom scheme: coffeemaker://join/CODE parses "join" as the host.
    const path = parsed.protocol.startsWith('http') ? parsed.pathname : `/${parsed.host}${parsed.pathname}`;
    navigate(path);
  });
  requestAnimationFrame(() => void SplashScreen.hide());
}

const TOKEN_KEY = 'coffee-maker:push-token';

/**
 * APNs (iOS) / FCM (Android) registration through @capacitor/push-notifications. The token is stored
 * on the server (native_push_tokens) and the notify Edge Function sends to it.
 */
export function createNativePush(): PushPort {
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  let permission: NotificationPermission = 'default';
  const plugin = () => import('@capacitor/push-notifications').then((m) => m.PushNotifications);
  void plugin()
    .then((p) => p.checkPermissions())
    .then((r) => {
      permission = r.receive === 'granted' ? 'granted' : r.receive === 'denied' ? 'denied' : 'default';
    })
    .catch(() => {});

  return {
    supported: () => true,
    permission: () => permission,
    async subscribe() {
      const p = await plugin();
      const { receive } = await p.requestPermissions();
      permission = receive === 'granted' ? 'granted' : 'denied';
      if (receive !== 'granted') return null;
      const token = await new Promise<string | null>((resolve) => {
        void p.addListener('registration', ({ value }) => resolve(value));
        void p.addListener('registrationError', () => resolve(null));
        void p.register();
      });
      if (!token) return null;
      localStorage.setItem(TOKEN_KEY, token);
      return { kind: 'native', token, platform };
    },
    async unsubscribe() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return null;
      await (await plugin()).unregister().catch(() => {});
      localStorage.removeItem(TOKEN_KEY);
      return { kind: 'native', token, platform };
    },
    current: async () => (permission === 'granted' ? localStorage.getItem(TOKEN_KEY) : null),
  };
}
