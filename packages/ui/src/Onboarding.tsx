import type { GroupSummary } from '@coffee/app';
import type { GroupMode } from '@coffee/core';
import { useEffect, useState } from 'react';
import { useLedger, useStoreApi, useT, useUi } from './context';
import { Segmented } from './primitives';
import { PALETTE_CHOICES } from './SettingsSheet';

/**
 * No active group. Local-only: create one (or open the demo). Synced: groups belong to a Google account, so
 * sign in first, then pick one of the account's groups or create another.
 */
export function Onboarding({ onDemo }: { onDemo?: () => void }) {
  const t = useT();
  const synced = useStoreApi().remote !== null;
  const account = useLedger((s) => s.account);
  const signedIn = !!account && !account.anonymous;

  return (
    <main className="cm-onboarding">
      <div className="cm-onboarding-card">
        <div className="cm-onboarding-mark" aria-hidden>
          💀☕
        </div>
        <h1>{t('onboarding.title')}</h1>
        {synced && !signedIn ? (
          <SignIn />
        ) : (
          <>
            {synced && <GroupList />}
            {!synced && <p>{t('onboarding.body')}</p>}
            <CreateGroup />
          </>
        )}
        {onDemo && (
          <button type="button" className="cm-button cm-button-ghost" onClick={onDemo}>
            {t('onboarding.demo')}
          </button>
        )}
      </div>
    </main>
  );
}

function SignIn() {
  const t = useT();
  const { toast } = useUi();
  const signIn = useLedger((s) => s.signIn);
  return (
    <div className="cm-form">
      <p>{t('groups.loginBody')}</p>
      <button
        type="button"
        className="cm-button cm-button-primary"
        onClick={() => signIn(`${location.origin}/`).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error'))}
      >
        {t('account.login')}
      </button>
    </div>
  );
}

function GroupList() {
  const t = useT();
  const { toast } = useUi();
  const account = useLedger((s) => s.account);
  const myGroups = useLedger((s) => s.myGroups);
  const openGroup = useLedger((s) => s.openGroup);
  const signOut = useLedger((s) => s.signOut);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  useEffect(() => {
    myGroups().then(setGroups, (e: unknown) => {
      setGroups([]);
      toast(e instanceof Error ? e.message : String(e), 'error');
    });
  }, [myGroups, toast]);

  return (
    <section className="cm-form" aria-labelledby="groups-h">
      <div className="cm-row cm-spread">
        <h2 id="groups-h" className="cm-field-label">
          {t('groups.title')}
        </h2>
        <span className="cm-muted cm-account">
          {account?.email}
          <button type="button" className="cm-link" onClick={() => void signOut()}>
            {t('account.logout')}
          </button>
        </span>
      </div>
      {groups === null ? (
        <p className="cm-muted">{t('app.loading')}</p>
      ) : groups.length === 0 ? (
        <p className="cm-muted">{t('groups.empty')}</p>
      ) : (
        <ul className="cm-groups">
          {groups.map((g) => (
            <li key={g.groupId}>
              <button type="button" className="cm-group" onClick={() => void openGroup(g)}>
                <span className="cm-group-name">{t('groups.item', { name: g.name || g.inviteCode })}</span>
                <span className="cm-muted">
                  {t('groups.meta', { player: g.playerName ?? t('groups.noPlayer'), members: g.members })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateGroup() {
  const t = useT();
  const synced = useStoreApi().remote !== null;
  const createGroup = useLedger((s) => s.createGroup);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<GroupMode>('attendance');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="cm-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await createGroup({ ownerName: name, appearance: { color: PALETTE_CHOICES[0]! }, mode });
        setBusy(false);
      }}
    >
      {synced && <h2 className="cm-field-label">{t('groups.new')}</h2>}
      <label className="cm-field">
        <span className="cm-field-label">{t('onboarding.name')}</span>
        {/* No autofocus on touch screens: the keyboard would cover the welcome on first launch. */}
        <input
          className="cm-input"
          required
          maxLength={20}
          autoFocus={!synced && typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="cm-field">
        <span className="cm-field-label">{t('mode.title')}</span>
        <Segmented<GroupMode>
          label={t('mode.title')}
          value={mode}
          options={[
            { value: 'attendance', label: t('mode.attendance') },
            { value: 'shared', label: t('mode.shared') },
          ]}
          onChange={setMode}
        />
        <span className="cm-field-hint">{t(mode === 'attendance' ? 'mode.attendanceHint' : 'mode.sharedHint')}</span>
      </div>
      <button type="submit" className="cm-button cm-button-primary" disabled={!name.trim() || busy}>
        {t('onboarding.create')}
      </button>
    </form>
  );
}
