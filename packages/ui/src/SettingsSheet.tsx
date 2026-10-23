import {
  activePlayers,
  computeCups,
  currentRuleset,
  judgeLateness,
  RULESET_LIMITS,
  toMinutes,
  validateRuleset,
  type CupTier,
  type Player,
  type Ruleset,
} from '@coffee/core';
import type { Tone } from '@coffee/theme';
import { useMemo, useState } from 'react';
import { useCommand, useLedger, useT, useUi } from './context';
import { ColorDot, Field, Segmented, Sheet, Stepper } from './primitives';

export const PALETTE_CHOICES = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581', '#ffd54f', '#90a4ae'];

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('settings.title')}>
      {open && (
        <div className="cm-stack">
          <RulesEditor />
          <PlayersEditor />
          <DeviceSection />
        </div>
      )}
    </Sheet>
  );
}

/** Example lateness used for the before/after preview. */
const PREVIEW_MINUTES = 20;

function RulesEditor() {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const saved = currentRuleset(ledger);
  const [draft, setDraft] = useState<Ruleset>(saved);
  const isOwner = !!me && ledger.players[me]?.role === 'owner';
  const issues = useMemo(() => validateRuleset(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const cupsFor = (rs: Ruleset) => {
    const j = judgeLateness(addMinutes(rs.defaultStartTime, PREVIEW_MINUTES), rs.defaultStartTime, rs.graceMinutes);
    return computeCups(j, rs.cupRule);
  };
  const tiers: CupTier[] =
    draft.cupRule.mode === 'tiered'
      ? draft.cupRule.tiers
      : [
          { upToMinutes: 15, cups: 1 },
          { upToMinutes: null, cups: 2 },
        ];
  const setTiers = (next: CupTier[]) => setDraft({ ...draft, cupRule: { mode: 'tiered', tiers: next } });

  async function save() {
    const d = await run({ type: 'ChangeRuleset', ruleset: draft });
    if (d.ok) toast(t('settings.saved'));
  }

  return (
    <section className="cm-section" aria-labelledby="rules-h">
      <h3 id="rules-h">{t('settings.rules')}</h3>
      {!isOwner && <p className="cm-muted">{t('settings.ownerOnly')}</p>}
      <fieldset disabled={!isOwner} className="cm-form">
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
          <TierEditor tiers={tiers} onChange={setTiers} />
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
        <p className="cm-muted">{t('settings.timezone', { tz: draft.timezone })}</p>
        {dirty && (
          <div className="cm-preview is-late" role="status">
            <div className="cm-preview-main">
              {t('settings.preview', {
                start: draft.defaultStartTime,
                minutes: PREVIEW_MINUTES,
                before: cupsFor(saved),
                after: cupsFor(draft),
              })}
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
          disabled={!dirty || issues.length > 0}
          onClick={() => void save()}
        >
          {t('action.save')}
        </button>
      </fieldset>
    </section>
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

  return (
    <section className="cm-section" aria-labelledby="players-h">
      <h3 id="players-h">{t('settings.players')}</h3>
      <ul className="cm-list">
        {players.map((p) => (
          <PlayerRow key={p.id} player={p} canEdit={isOwner || p.id === me} canArchive={isOwner && p.id !== me} />
        ))}
      </ul>
      <form
        className="cm-row cm-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
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
        <button type="submit" className="cm-button" disabled={!name.trim()}>
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
  const dirty = name !== player.name || color !== player.appearance.color || start !== (player.startTimeOverride ?? '');

  return (
    <li className="cm-player-row">
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
      {dirty && (
        <button
          type="button"
          className="cm-button"
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
      )}
      {canArchive && (
        <button
          type="button"
          className="cm-icon-button"
          aria-label={`${player.name} ${t('settings.archive')}`}
          title={t('settings.archive')}
          onClick={() => void run({ type: 'UpdatePlayer', playerId: player.id, patch: { archived: true } })}
        >
          ⤓
        </button>
      )}
    </li>
  );
}

function DeviceSection() {
  const t = useT();
  const { tone, setTone } = useUi();
  const ledger = useLedger((s) => s.ledger);
  const me = useLedger((s) => s.me);
  const setMe = useLedger((s) => s.setMe);
  const players = activePlayers(ledger);
  return (
    <section className="cm-section" aria-labelledby="device-h">
      <h3 id="device-h">{t('settings.device')}</h3>
      <Field label={t('settings.me')}>
        <select className="cm-input" value={me ?? ''} onChange={(e) => void setMe(e.target.value as Player['id'])}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
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
    </section>
  );
}

function addMinutes(hhmm: string, minutes: number): string {
  const total = Math.min(23 * 60 + 59, toMinutes(hhmm) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
