import { useEffect, useState } from 'react';
import { useLedger, useT, useUi } from './context';

/** Transient messages plus the 5-second undo offer after recording or proposing. */
export function Toasts() {
  const t = useT();
  const { toasts, dismissToast } = useUi();
  const undo = useLedger((s) => s.undo);
  const undoLast = useLedger((s) => s.undoLast);
  const dismissUndo = useLedger((s) => s.dismissUndo);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!undo) return;
    const ms = undo.expiresAt - Date.now();
    const timer = setTimeout(() => {
      dismissUndo();
      tick((x) => x + 1);
    }, Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [undo, dismissUndo]);

  return (
    <div className="cm-toasts" role="region" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`cm-toast ${x.kind === 'error' ? 'is-error' : ''}`} onClick={() => dismissToast(x.id)}>
          {x.message}
        </div>
      ))}
      {undo && (
        <div className="cm-toast cm-toast-undo">
          <button type="button" className="cm-button cm-button-ghost" onClick={() => void undoLast()}>
            ↶ {t('action.undo')}
          </button>
        </div>
      )}
    </div>
  );
}
