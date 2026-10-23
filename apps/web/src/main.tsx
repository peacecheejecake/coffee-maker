import { createLocalIdbStores, createSupabaseAssets, createSupabaseRemote } from '@coffee/adapters';
import { createLedgerStore, startSync } from '@coffee/app';
import { LedgerProvider, webPlatform } from '@coffee/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { config, syncEnabled } from './config';
import { createNativePlatform, createNativePush, initNativeShell, isNative } from './native';
import { createBrowserPush } from './push';
import './styles.css';

// Composition root: the only place that picks concrete adapters.
const remote = syncEnabled ? createSupabaseRemote(config.supabaseUrl!, config.supabaseAnonKey!) : null;
// A separate database name keeps a synced profile apart from local-only data on the same origin.
const local = createLocalIdbStores(remote ? 'coffee-maker-sync' : 'coffee-maker');
const store = createLedgerStore({
  ...local,
  remote,
  // Shared groups keep evidence photos on the server so every member can see them.
  assets: remote ? createSupabaseAssets(remote.client) : local.assets,
  push: remote ? (isNative() ? createNativePush() : createBrowserPush(config.vapidPublicKey)) : null,
});
void store
  .getState()
  .init()
  .then(() => startSync(store));

// Service worker: offline app shell + push notifications. Production web only: the native shell already
// bundles the app, and dev serves modules unbundled.
if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

/** Client-side navigation from outside React (deep links); App listens for popstate. */
const navigate = (path: string) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
};

async function bootstrap() {
  const platform = isNative() ? await createNativePlatform() : webPlatform;
  if (isNative()) {
    void initNativeShell(navigate);
    // QA builds: VITE_NATIVE_START_PATH=/demo opens a route on launch (no deep-link dialog to tap through).
    const start = import.meta.env.VITE_NATIVE_START_PATH;
    if (start && location.pathname === '/') history.replaceState(null, '', start);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LedgerProvider store={store} platform={platform}>
        <App />
      </LedgerProvider>
    </StrictMode>,
  );
}

void bootstrap();
