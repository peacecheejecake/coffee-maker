import { useState } from 'react';
import { useLedger, useT } from './context';
import { PALETTE_CHOICES } from './SettingsSheet';

export function Onboarding({ onDemo }: { onDemo?: () => void }) {
  const t = useT();
  const createGroup = useLedger((s) => s.createGroup);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <main className="cm-onboarding">
      <div className="cm-onboarding-card">
        <div className="cm-onboarding-mark" aria-hidden>
          💀☕
        </div>
        <h1>{t('onboarding.title')}</h1>
        <p>{t('onboarding.body')}</p>
        <form
          className="cm-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await createGroup({ ownerName: name, appearance: { color: PALETTE_CHOICES[0]! } });
            setBusy(false);
          }}
        >
          <label className="cm-field">
            <span className="cm-field-label">{t('onboarding.name')}</span>
            {/* No autofocus on touch screens: the keyboard would cover the welcome on first launch. */}
            <input
              className="cm-input"
              required
              maxLength={20}
              autoFocus={typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="cm-button cm-button-primary" disabled={!name.trim() || busy}>
            {t('onboarding.create')}
          </button>
        </form>
        {onDemo && (
          <button type="button" className="cm-button cm-button-ghost" onClick={onDemo}>
            {t('onboarding.demo')}
          </button>
        )}
      </div>
    </main>
  );
}
