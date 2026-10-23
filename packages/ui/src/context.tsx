import type { LedgerActions, LedgerStore, LedgerStoreState } from '@coffee/app';
import type { Command, Decision } from '@coffee/core';
import { createTranslator, type Tone, type Translate } from '@coffee/theme';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

const StoreContext = createContext<LedgerStore | null>(null);

interface UiContextValue {
  tone: Tone;
  setTone: (tone: Tone) => void;
  t: Translate;
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

const UiContext = createContext<UiContextValue | null>(null);

const TONE_KEY = 'coffee-maker:tone';

function readTone(): Tone {
  try {
    return localStorage.getItem(TONE_KEY) === 'plain' ? 'plain' : 'underworld';
  } catch {
    return 'underworld';
  }
}

export function LedgerProvider({ store, children }: { store: LedgerStore; children: ReactNode }) {
  const [tone, setToneState] = useState<Tone>(readTone);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const setTone = useCallback((next: Tone) => {
    setToneState(next);
    try {
      localStorage.setItem(TONE_KEY, next);
    } catch {
      // Private mode etc.: the tone just won't persist.
    }
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, kind: Toast['kind'] = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-2), { id, message, kind }]);
      setTimeout(() => dismissToast(id), kind === 'error' ? 5000 : 3000);
    },
    [dismissToast],
  );

  const ui = useMemo(
    () => ({ tone, setTone, t: createTranslator(tone), toasts, toast, dismissToast }),
    [tone, setTone, toasts, toast, dismissToast],
  );

  return (
    <StoreContext.Provider value={store}>
      <UiContext.Provider value={ui}>{children}</UiContext.Provider>
    </StoreContext.Provider>
  );
}

export function useStoreApi(): LedgerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('LedgerProvider missing');
  return store;
}

export function useLedger<T>(selector: (s: LedgerStoreState & LedgerActions) => T): T {
  return useStore(useStoreApi(), selector);
}

export function useUi(): UiContextValue {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('LedgerProvider missing');
  return ui;
}

export const useT = (): Translate => useUi().t;

/** Dispatches a command and reports domain errors as toasts. */
export function useCommand(): (cmd: Command) => Promise<Decision> {
  const dispatch = useLedger((s) => s.dispatch);
  const { t, toast } = useUi();
  return useCallback(
    async (cmd) => {
      const d = await dispatch(cmd);
      if (!d.ok) toast(t(`error.${d.error.code}`), 'error');
      return d;
    },
    [dispatch, t, toast],
  );
}
