import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell around the web build (PLAN.md M7). The app is apps/web unchanged; native features come in
 * through the Platform port (apps/web/src/native.ts).
 */
const config: CapacitorConfig = {
  appId: 'app.coffeemaker.underworld',
  appName: '저승 커피',
  webDir: '../web/dist',
  backgroundColor: '#141226',
  ios: { contentInset: 'never', scheme: 'App' },
  android: { backgroundColor: '#141226' },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#141226', showSpinner: false },
    StatusBar: { style: 'DARK', overlaysWebView: true },
    LocalNotifications: { iconColor: '#f2a65a' },
  },
};

export default config;
