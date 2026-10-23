import { createLocalIdbStores, createSupabaseAssets, createSupabaseRemote } from '@coffee/adapters';
import { createLedgerStore, startSync } from '@coffee/app';
import { LedgerProvider } from '@coffee/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { config, syncEnabled } from './config';
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
});
void store
  .getState()
  .init()
  .then(() => startSync(store));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LedgerProvider store={store}>
      <App />
    </LedgerProvider>
  </StrictMode>,
);
