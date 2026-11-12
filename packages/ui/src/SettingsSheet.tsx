import {
  activePlayers,
  computeCups,
  currentRuleset,
  isPolygonArea,
  isSoloMember,
  isSpectator,
  judgeLateness,
  RULESET_LIMITS,
  toMinutes,
  validateRuleset,
  type CupTier,
  type Player,
  type Ruleset,
  type Workplace,
} from '@coffee/core';
import type { Tone } from '@coffee/theme';
import { useEffect, useMemo, useState } from 'react';
import { useCommand, useLedger, useStoreApi, useT, useUi } from './context';
import { formatWorkDate } from './format';
import { GroupSection } from './GroupSettings';
import { useMotionFeedback } from './Motions';
import { ColorDot, ConfirmBox, Field, Segmented, Sheet, Stepper } from './primitives';
import { WorkplaceSheet } from './WorkplaceSheet';

export const PALETTE_CHOICES = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581', '#ffd54f', '#90a4ae'];

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('settings.title')}>
      {open && (
        <div className="cm-stack">
          <InviteSection />
          <AccountSection />
          <GroupSection />
          <RulesEditor />
          <PlayersEditor />
          <DeviceSection />
        </div>
      )}
    </Sheet>
  );
}

/** When each cup count starts on a day, judged exactly as check-ins are (so grace and tiers need no re-explaining). */
export function lateSchedule(rs: Ruleset): { at: string; cups: number }[] {
  const steps: { at: string; cups: number }[] = [];
  let last = 0;
  for (let m = 0; toMinutes(rs.defaultStartTime) + m <= 23 * 60 + 59; m++) {
    const arrival = addMinutes(rs.defaultStartTime, m);
    const cups = computeCups(judgeLateness(arrival, rs.defaultStartTime, rs.graceMinutes), rs.cupRule);
    if (cups !== last) steps.push({ at: arrival, cups });
    last = cups;
  }
  return steps;
}

function RulesEditor() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const saved = currentRuleset(ledger);
  const [draft, setDraft] = useState<Ruleset>(saved);
  const feedback = useMotionFeedback();
  const api = useStoreApi();
  const isOwner = !!me && ledger.players[me]?.role === 'owner';
  const issues = useMemo(() => validateRuleset(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // Attendance mode: the owner confirms the first rules once; after that anyone proposes changes for a vote.
  const attendance = ledger.mode === 'attendance';
  const { startsOn } = ledger.attendance;
  const stage = !attendance ? 'owner' : !startsOn ? 'adopt' : 'propose';
  const canEdit = stage === 'propose' || isOwner;
  // Alone, a rule change passes on the spot, so it reads as a plain save.
  const solo = isSoloMember(ledger, me);
  const [confirmAdopt, setConfirmAdopt] = useState(false);
  const [pickingPlace, setPickingPlace] = useState(false);
  const setWorkplace = (w: Workplace | undefined) => {
    const { workplace: _, ...rest } = draft;
    setDraft(w ? { ...rest, workplace: w } : rest);
  };

  const schedule = (rs: Ruleset) => {
    const steps = lateSchedule(rs);
    return steps.length === 0 ? t('settings.previewNone') : steps.map((st) => t('settings.previewStep', st)).join(', ');
  };
  const before = schedule(saved);
  const after = schedule(draft);
  const tiers: CupTier[] =
    draft.cupRule.mode === 'tiered'
      ? draft.cupRule.tiers
      : [
          { upToMinutes: 15, cups: 1 },
          { upToMinutes: null, cups: 2 },
        ];
  const setTiers = (next: CupTier[]) => setDraft({ ...draft, cupRule: { mode: 'tiered', tiers: next } });

  async function save() {
    if (stage === 'adopt') {
      setConfirmAdopt(false);
      const d = await run({ type: 'AdoptRules', ruleset: draft });
      const starts = d.ok ? api.getState().ledger.attendance.startsOn : undefined;
      if (starts) toast(t('rules.adopted', { date: formatWorkDate(starts) }));
      return;
    }
    if (stage === 'propose') {
      const d = await run({ type: 'ProposeMotion', motion: { kind: 'ruleset', ruleset: draft } });
      if (!d.ok) return;
      if (solo) toast(t('settings.saved'));
      else feedback(d.value[0]?.id);
      return;
    }
    const d = await run({ type: 'ChangeRuleset', ruleset: draft });
    if (d.ok) toast(t('settings.saved'));
  }

  return (
    <section className="cm-section" aria-labelledby="rules-h">
      <h3 id="rules-h">{stage === 'adopt' ? t('rules.adoptTitle') : t('settings.rules')}</h3>
      {stage === 'owner' && !isOwner && <p className="cm-muted">{t('settings.ownerOnly')}</p>}
      {stage === 'adopt' && <p className="cm-muted">{isOwner ? t(solo ? 'rules.adoptBodySolo' : 'rules.adoptBody') : t('rules.waitingOwner')}</p>}
      {stage === 'propose' && startsOn && <p className="cm-muted">{t(solo ? 'rules.inForceSolo' : 'rules.inForce', { date: formatWorkDate(startsOn) })}</p>}
      <fieldset disabled={!canEdit} className="cm-form">
        <div className="cm-grid2">
        <Field label={t('settings.startTime')}>
          <input
            type="time"
            className="cm-input"
            value={draft.defaultStartTime}
            onChange={(e) => e.target.value && setDraft({ ...draft, defaultStartTime: e.target.value })}
          />
        </Field>
        <Field label={t('settings.grace')}>
          <Stepper
            label={t('settings.grace')}
            value={draft.graceMinutes}
            {...RULESET_LIMITS.graceMinutes}
            onChange={(graceMinutes) => setDraft({ ...draft, graceMinutes })}
          />
        </Field>
        <Field label={t('settings.cupMode')}>
          <Segmented
            label={t('settings.cupMode')}
            value={draft.cupRule.mode}
            options={[
              { value: 'fixed', label: t('settings.cupMode.fixed') },
              { value: 'tiered', label: t('settings.cupMode.tiered') },
            ]}
            onChange={(mode) =>
              setDraft({ ...draft, cupRule: mode === 'fixed' ? { mode, cups: 1 } : { mode, tiers } })
            }
          />
        </Field>
        {draft.cupRule.mode === 'fixed' ? (
          <Field label={t('settings.cups')}>
            <Stepper
              label={t('settings.cups')}
              value={draft.cupRule.cups}
              {...RULESET_LIMITS.fixedCups}
              onChange={(cups) => setDraft({ ...draft, cupRule: { mode: 'fixed', cups } })}
            />
          </Field>
        ) : (
          <div className="cm-span">
            <TierEditor tiers={tiers} onChange={setTiers} />
          </div>
        )}
        <Field label={t('settings.waiveTtl')} hint={t('settings.waivePolicy')}>
          <Stepper
            label={t('settings.waiveTtl')}
            value={draft.waivePolicy.ttlHours}
            {...RULESET_LIMITS.waiveTtlHours}
            step={24}
            onChange={(ttlHours) => setDraft({ ...draft, waivePolicy: { ...draft.waivePolicy, ttlHours } })}
          />
        </Field>
        <Field label={t('calendar.publicHolidays')}>
          <Segmented<'KR' | 'none'>
            label={t('calendar.publicHolidays')}
            value={draft.publicHolidays ?? 'KR'}
            options={[
              { value: 'KR', label: t('calendar.publicHolidays.on') },
              { value: 'none', label: t('calendar.publicHolidays.off') },
            ]}
            onChange={(publicHolidays) => setDraft({ ...draft, publicHolidays })}
          />
        </Field>
        </div>
        {attendance && (
          <WorkplaceField
            value={draft.workplace}
            changed={JSON.stringify(draft.workplace) !== JSON.stringify(saved.workplace)}
            onEdit={() => setPickingPlace(true)}
          />
        )}
        <p className="cm-muted">{t('settings.timezone', { tz: draft.timezone })}</p>
        {dirty && (
          <div className="cm-preview is-late" role="status">
            <div className="cm-preview-main">
              {before === after ? (
                t('settings.previewSame', { schedule: after })
              ) : (
                <>
                  <div>{t('settings.previewAfter', { schedule: after })}</div>
                  <div className="cm-preview-before">{t('settings.previewBefore', { schedule: before })}</div>
                </>
              )}
            </div>
            <div className="cm-preview-basis">{t('settings.notRetroactive')}</div>
          </div>
        )}
        {issues.length > 0 && (
          <ul className="cm-errors" role="alert">
            {issues.map((i) => (
              <li key={i.path}>
                {i.path}: {i.message}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="cm-button cm-button-primary"
          disabled={(stage !== 'adopt' && !dirty) || issues.length > 0}
          onClick={() => (stage === 'adopt' ? setConfirmAdopt(true) : void save())}
        >
          {stage === 'adopt' ? t('rules.adopt') : stage === 'propose' && !solo ? t('rules.propose') : t('action.save')}
        </button>
        {confirmAdopt && (
          <ConfirmBox
            message={t('rules.adoptConfirm')}
            confirmLabel={t('rules.adopt')}
            onConfirm={() => void save()}
            onCancel={() => setConfirmAdopt(false)}
          />
        )}
      </fieldset>
      <WorkplaceSheet open={pickingPlace} onOpenChange={setPickingPlace} value={draft.workplace} onApply={setWorkplace} />
    </section>
  );
}

/** Attendance mode: the area check-ins must come from (part of the rules, so it changes by adoption or motion). */
function WorkplaceField({ value, changed, onEdit }: { value: Workplace | undefined; changed: boolean; onEdit: () => void }) {
  const t = useT();
  return (
    <div className="cm-field" role="group" aria-labelledby="workplace-h">
      <span className="cm-field-label" id="workplace-h">
        {t('workplace.title')}
      </span>
      <div className="cm-row cm-wrap">
        <span>
          📍{' '}
          {!value
            ? t('workplace.none')
            : isPolygonArea(value)
              ? t('workplace.summaryPolygon', { label: value.label ?? t('workplace.unnamed'), count: value.points.length })
              : t('workplace.summary', { label: value.label ?? t('workplace.unnamed'), radius: value.radiusMeters })}
        </span>
        <button type="button" className="cm-button" onClick={onEdit}>
          {t('workplace.edit')}
        </button>
      </div>
      <span className="cm-field-hint">{changed ? t('workplace.pending') : t('workplace.hint')}</span>
    </div>
  );
}

/** Rows of "up to N minutes → C cups"; the last row is always "beyond". Kept sorted on blur. */
export function TierEditor({ tiers, onChange }: { tiers: CupTier[]; onChange: (tiers: CupTier[]) => void }) {
  const t = useT();
  const update = (i: number, patch: Partial<CupTier>) => onChange(tiers.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const sortBounded = () => {
    const bounded = tiers.slice(0, -1).sort((a, b) => (a.upToMinutes ?? 0) - (b.upToMinutes ?? 0));
    onChange([...bounded, tiers[tiers.length - 1]!]);
  };
  const add = () => {
    const bounded = tiers.slice(0, -1);
    const last = bounded.at(-1)?.upToMinutes ?? 0;
    onChange([...bounded, { upToMinutes: last + 15, cups: (bounded.at(-1)?.cups ?? 0) + 1 }, tiers[tiers.length - 1]!]);
  };
  return (
    <div className="cm-tiers" role="table" aria-label={t('settings.cupMode.tiered')}>
      {tiers.map((tier, i) => {
        const isLast = i === tiers.length - 1;
        return (
          <div className="cm-row" role="row" key={i}>
            {isLast ? (
              <span className="cm-tier-label">{t('settings.tierRest')}</span>
            ) : (
              <label className="cm-tier-label">
                ~
                <input
                  type="number"
                  inputMode="numeric"
                  className="cm-input cm-input-narrow"
                  min={1}
                  value={tier.upToMinutes ?? ''}
                  aria-label={t('settings.tierUpTo', { minutes: tier.upToMinutes ?? '' })}
                  onChange={(e) => update(i, { upToMinutes: Number(e.target.value) })}
                  onBlur={sortBounded}
                />
                분
              </label>
            )}
            <Stepper
              label={`${t('settings.cups')} ${i + 1}`}
              value={tier.cups}
              {...RULESET_LIMITS.tierCups}
              onChange={(cups) => update(i, { cups })}
            />
            {!isLast && tiers.length > 2 && (
              <button
                type="button"
                className="cm-icon-button"
                aria-label={t('settings.tierRemove')}
                onClick={() => onChange(tiers.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="cm-button cm-button-ghost" onClick={add}>
        + {t('settings.tierAdd')}
      </button>
    </div>
  );
}

function PlayersEditor() {
  const t = useT();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const players = activePlayers(ledger);
  const isOwner = !!me && ledger.players[me]?.role === 'owner';
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE_CHOICES[players.length % PALETTE_CHOICES.length]!);

  async function add() {
    const d = await run({ type: 'AddPlayer', name, appearance: { color } });
    if (d.ok) {
      setName('');
      setColor(PALETTE_CHOICES[(players.length + 1) % PALETTE_CHOICES.length]!);
    }
  }

  // Every row, the header and the add form share one column template (.cm-player-row), so fields line up.
  return (
    <section className="cm-section" aria-labelledby="players-h">
      <h3 id="players-h">{t('settings.players')}</h3>
      <div className="cm-player-row cm-player-head" aria-hidden>
        <span />
        <span>{t('settings.playerName')}</span>
        <span>{t('settings.playerColor')}</span>
        <span>{t('settings.playerStart')}</span>
        <span />
      </div>
      <ul className="cm-list">
        {players.map((p) => (
          <PlayerRow key={p.id} player={p} canEdit={isOwner || p.id === me} canArchive={isOwner && p.id !== me} />
        ))}
      </ul>
      <form
        className="cm-player-row"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <ColorDot color={color} />
        <input
          className="cm-input"
          required
          maxLength={20}
          placeholder={t('settings.playerName')}
          aria-label={t('settings.playerName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input type="color" aria-label={t('settings.playerColor')} value={color} onChange={(e) => setColor(e.target.value)} />
        <button type="submit" className="cm-button cm-player-add" disabled={!name.trim()}>
          + {t('settings.addPlayer')}
        </button>
      </form>
    </section>
  );
}

function PlayerRow({ player, canEdit, canArchive }: { player: Player; canEdit: boolean; canArchive: boolean }) {
  const t = useT();
  const run = useCommand();
  const [name, setName] = useState(player.name);
  const [color, setColor] = useState(player.appearance.color);
  const [start, setStart] = useState(player.startTimeOverride ?? '');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const spectating = useLedger((s) => isSpectator(s.ledger, player.id));
  const dirty = name !== player.name || color !== player.appearance.color || start !== (player.startTimeOverride ?? '');
  const revert = () => {
    setName(player.name);
    setColor(player.appearance.color);
    setStart(player.startTimeOverride ?? '');
  };

  return (
    <li className="cm-player-item">
      <div className="cm-player-row">
        <ColorDot color={color} />
        <input
          className="cm-input"
          aria-label={t('settings.playerName')}
          disabled={!canEdit}
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
        />
        <input type="color" aria-label={t('settings.playerColor')} disabled={!canEdit} value={color} onChange={(e) => setColor(e.target.value)} />
        <input
          type="time"
          className="cm-input"
          aria-label={t('settings.playerStart')}
          title={t('settings.playerStart')}
          disabled={!canEdit}
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        {canArchive ? (
          <button
            type="button"
            className="cm-icon-button is-remove"
            aria-label={`${player.name} ${t('settings.archive')}`}
            aria-expanded={confirmArchive}
            title={t('settings.archive')}
            onClick={() => setConfirmArchive((c) => !c)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <span aria-hidden />
        )}
      </div>
      {/* Save sits under the row so an edit never shifts the columns. */}
      {dirty && (
        <div className="cm-row cm-player-actions">
          <button
            type="button"
            className="cm-button cm-button-primary"
            onClick={() =>
              void run({
                type: 'UpdatePlayer',
                playerId: player.id,
                patch: { name, appearance: { ...player.appearance, color }, startTimeOverride: start || null },
              })
            }
          >
            {t('action.save')}
          </button>
          <button type="button" className="cm-button cm-button-ghost" onClick={revert}>
            {t('action.cancel')}
          </button>
        </div>
      )}
      {spectating && <span className="cm-badge">{t('spectate.badge')}</span>}
      {confirmArchive && (
        <div className="cm-warning" role="alert">
          <p>
            {player.name} · {t('settings.archive')}?
          </p>
          <div className="cm-row">
            <button
              type="button"
              className="cm-button cm-button-danger"
              onClick={() => void run({ type: 'UpdatePlayer', playerId: player.id, patch: { archived: true } })}
            >
              {t('settings.archive')}
            </button>
            <button type="button" className="cm-button cm-button-ghost" onClick={() => setConfirmArchive(false)}>
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function InviteSection() {
  const t = useT();
  const { toast, platform } = useUi();
  const sync = useLedger((s) => s.sync);
  const code = useLedger((s) => s.inviteCode);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (sync === 'local') return null;
  const url = code ? `${location.origin}/join/${code}` : null;
  return (
    <section className="cm-section" aria-labelledby="invite-h">
      <h3 id="invite-h">{t('invite.title')}</h3>
      {url ? (
        <div className="cm-form">
          <p className="cm-muted">{t('invite.body')}</p>
          <input className="cm-input" readOnly value={url} aria-label={t('invite.title')} onFocus={(e) => e.target.select()} />
          <div className="cm-row">
            <button
              type="button"
              className="cm-button"
              onClick={async () => {
                await navigator.clipboard?.writeText(url);
                toast(t('invite.copied'));
                setCopied(true);
              }}
            >
              {t('invite.copy')}
            </button>
            {copied && (
              <span className="cm-copied" role="img" aria-label={t('invite.copied')}>
                ✓
              </span>
            )}
            {platform.canShare({ url }) && (
              <button type="button" className="cm-button" onClick={() => void platform.share({ title: t('app.title'), url })}>
                {t('invite.share')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="cm-muted">{t('invite.pending')}</p>
      )}
    </section>
  );
}

function DeviceSection() {
  const t = useT();
  const { tone, setTone, sound, setSound } = useUi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const setMe = useLedger((s) => s.setMe);
  const sync = useLedger((s) => s.sync);
  const players = activePlayers(ledger);
  return (
    <section className="cm-section" aria-labelledby="device-h">
      <h3 id="device-h">{t('settings.device')}</h3>
      <div className="cm-grid2">
      {/* In a shared group the device user is the claimed account, not a free choice. */}
      {sync === 'local' && (
        <Field label={t('settings.me')}>
          <select className="cm-input" value={me ?? ''} onChange={(e) => void setMe(e.target.value as Player['id'])}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('settings.tone')}>
        <Segmented<Tone>
          label={t('settings.tone')}
          value={tone}
          options={[
            { value: 'underworld', label: t('settings.tone.underworld') },
            { value: 'plain', label: t('settings.tone.plain') },
          ]}
          onChange={setTone}
        />
      </Field>
      <NotificationsField />
      <ReminderField />
      <AutoCheckInField />
      <Field label={t('settings.sound')}>
        <Segmented<'on' | 'off'>
          label={t('settings.sound')}
          value={sound ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('settings.sound.on') },
            { value: 'off', label: t('settings.sound.off') },
          ]}
          onChange={(v) => setSound(v === 'on')}
        />
      </Field>
      </div>
    </section>
  );
}

function addMinutes(hhmm: string, minutes: number): string {
  const total = Math.min(23 * 60 + 59, toMinutes(hhmm) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function NotificationsField() {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  const sync = useLedger((s) => s.sync);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.getState().notificationsEnabled().then(setOn);
  }, [api]);
  if (sync === 'local' || !api.supportsPush) return null;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return (
    <Field label={t('settings.notifications')} hint={ios && !standalone ? t('settings.notifications.ios') : t('settings.notifications.hint')}>
      <Segmented<'on' | 'off'>
        label={t('settings.notifications')}
        value={on ? 'on' : 'off'}
        disabled={busy}
        options={[
          { value: 'on', label: t('settings.notifications.on') },
          { value: 'off', label: t('settings.notifications.off') },
        ]}
        onChange={async (v) => {
          setBusy(true);
          try {
            const result = await api.getState().setNotifications(v === 'on');
            setOn(result);
            if (v === 'on' && !result) toast(t('settings.notifications.denied'), 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </Field>
  );
}

/** Per device: check in by itself when the app is opened inside the workplace. Shown once the rules set one. */
function AutoCheckInField() {
  const t = useT();
  const { toast } = useUi();
  const api = useStoreApi();
  const on = useLedger((s) => s.autoCheckIn);
  const me = useLedger((s) => s.me);
  const workplace = useLedger((s) => s.workplaceToday)();
  const [busy, setBusy] = useState(false);
  if (!me || !workplace || !api.supportsLocation) return null;
  return (
    <Field label={t('settings.autoCheckIn')} hint={t('settings.autoCheckIn.hint')}>
      <Segmented<'on' | 'off'>
        label={t('settings.autoCheckIn')}
        value={on ? 'on' : 'off'}
        disabled={busy}
        options={[
          { value: 'on', label: t('settings.sound.on') },
          { value: 'off', label: t('settings.sound.off') },
        ]}
        onChange={async (v) => {
          setBusy(true);
          try {
            const result = await api.getState().setAutoCheckIn(v === 'on');
            if (v === 'on' && !result) toast(t('settings.autoCheckIn.denied'), 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </Field>
  );
}

function AccountSection() {
  const t = useT();
  const sync = useLedger((s) => s.sync);
  const account = useLedger((s) => s.account);
  const closeGroup = useLedger((s) => s.closeGroup);
  const signOut = useLedger((s) => s.signOut);
  // Settings are for members, and members are signed in with Google.
  if (sync === 'local' || !account || account.anonymous) return null;
  return (
    <section className="cm-section" aria-labelledby="account-h">
      <h3 id="account-h">{t('settings.account')}</h3>
      <div className="cm-form">
        <p className="cm-muted">{t('settings.account.linked', { email: account.email ?? '' })}</p>
        <div className="cm-row cm-wrap">
          <button type="button" className="cm-button" onClick={() => void closeGroup()}>
            {t('settings.groups')}
          </button>
          <button type="button" className="cm-button cm-button-ghost" onClick={() => void signOut()}>
            {t('account.logout')}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Native shell only: a daily reminder ten minutes before the start time. */
function ReminderField() {
  const t = useT();
  const { platform, toast } = useUi();
  const ledger = useLedger((s) => s.ledger);
  const [on, setOn] = useState(false);
  useEffect(() => {
    void platform.reminder?.enabled().then(setOn);
  }, [platform]);
  if (!platform.reminder) return null;
  const start = toMinutes(currentRuleset(ledger).defaultStartTime) - 10;
  const at = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  return (
    <Field label={t('settings.reminder', { at })}>
      <Segmented<'on' | 'off'>
        label={t('settings.reminder', { at })}
        value={on ? 'on' : 'off'}
        options={[
          { value: 'on', label: t('settings.notifications.on') },
          { value: 'off', label: t('settings.notifications.off') },
        ]}
        onChange={async (v) => {
          const result = await platform.reminder!.set(v === 'on', at, {
            title: t('settings.reminder.title'),
            body: t('settings.reminder.body'),
          });
          setOn(result);
          if (v === 'on' && !result) toast(t('settings.notifications.denied'), 'error');
        }}
      />
    </Field>
  );
}
