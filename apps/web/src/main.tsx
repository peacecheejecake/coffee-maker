import { createLocalIdbStores } from '@coffee/adapters';
import { createLedgerStore } from '@coffee/app';
import { LedgerProvider } from '@coffee/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Composition root: the only place that picks concrete adapters.
const store = createLedgerStore(createLocalIdbStores());
void store.getState().init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LedgerProvider store={store}>
      <App />
    </LedgerProvider>
  </StrictMode>,
);
