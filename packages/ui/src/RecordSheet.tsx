import { activePlayers, previewArrival, MAX_CUPS_PER_RECORD, type EventId, type PlayerId } from '@coffee/core';
import { useMemo, useState } from 'react';
import { useCommand, useLedger, useT, useUi } from './context';
import { ColorDot, Field, Sheet, Stepper } from './primitives';

interface RecordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPlayerId?: PlayerId | null;
  /** Called when the user chooses to correct the existing record of a duplicate date. */
  onCorrectExisting: (id: EventId) => void;
}

/** Quick record (DESIGN.md §2.3): player → arrival time → live preview → submit, with optional manual fields. */
export function RecordSheet(props: RecordSheetProps) {
  const t = useT();
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} title={t('record.title')}>
      {/* Remount on every open so the form starts from "now". */}
      {props.open && <RecordForm {...props} />}
    </Sheet>
  );
}

function RecordForm({ onOpenChange, initialPlayerId, onCorrectExisting }: RecordSheetProps) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const wallNow = useLedger((s) => s.wallNow);
  const players = useMemo(() => activePlayers(ledger), [ledger]);
  const [now] = useState(wallNow);

  const [playerId, setPlayerId] = useState<PlayerId | undefined>(initialPlayerId ?? players[0]?.id);
  const [arrivedAt, setArrivedAt] = useState(now.hhmm);
  const [advanced, setAdvanced] = useState(false);
  const [workDate, setWorkDate] = useState(now.workDate);
  const [scheduledStart, setScheduledStart] = useState('');
  const [cupsOverride, setCupsOverride] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  const validTime = /^\d{2}:\d{2}$/.test(arrivedAt);
  const preview =
    playerId && validTime
      ? previewArrival(ledger, {
          playerId,
          workDate,
          arrivedAt,
          ...(scheduledStart && { scheduledStart }),
        })
      : null;
  const cups = cupsOverride ?? preview?.cups ?? 0;
  const blockedByDuplicate = !!preview?.duplicateOf && !allowDuplicate;
  const player = playerId ? ledger.players[playerId] : undefined;

  async function submit() {
    if (!playerId || !player) return;
    setBusy(true);
    const d = await run({
      type: 'RecordArrival',
      playerId,
      workDate,
      arrivedAt,
      ...(scheduledStart && { scheduledStart }),
      ...(cupsOverride !== null && { cupsOverride }),
      ...(note.trim() && { note }),
      allowDuplicate,
    });
    setBusy(false);
    if (!d.ok) return;
    toast(d.value.length === 0 ? t('record.onTime', { name: player.name }) : t('record.done', { name: player.name, cups }));
    onOpenChange(false);
  }

  return (
    <form
      className="cm-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="cm-chips">
        <legend className="cm-field-label">{t('record.player')}</legend>
        {players.map((p) => (
          <button
            key={p.id}
            type="button"
            className="cm-chip"
            aria-pressed={p.id === playerId}
            onClick={() => {
              setPlayerId(p.id);
              setAllowDuplicate(false);
            }}
          >
            <ColorDot color={p.appearance.color} />
            {p.name}
          </button>
        ))}
      </fieldset>

      <Field label={t('record.arrivedAt')}>
        <input type="time" required value={arrivedAt} onChange={(e) => setArrivedAt(e.target.value)} className="cm-input cm-input-time" />
      </Field>

      {preview && (
        <div className={`cm-preview ${cups > 0 ? 'is-late' : 'is-ontime'}`} role="status">
          <div className="cm-preview-main">
            {cups > 0 ? t('record.previewLate', { minutes: preview.minutesLate, cups }) : t('record.previewOnTime')}
          </div>
          <div className="cm-preview-basis">{t('record.basis', { start: preview.scheduledStart, grace: preview.graceMinutes })}</div>
        </div>
      )}

      {preview?.duplicateOf && !allowDuplicate && (
        <div className="cm-warning" role="alert">
          <p>{t('record.duplicate')}</p>
          <div className="cm-row">
            <button type="button" className="cm-button" onClick={() => onCorrectExisting(preview.duplicateOf!)}>
              {t('record.duplicateCorrect')}
            </button>
            <button type="button" className="cm-button cm-button-ghost" onClick={() => setAllowDuplicate(true)}>
              {t('record.duplicateAnyway')}
            </button>
          </div>
        </div>
      )}

      <details className="cm-details" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
        <summary>{t('record.advanced')}</summary>
        <div className="cm-form">
          <Field label={t('record.date')}>
            <input type="date" required value={workDate} max={now.workDate} onChange={(e) => setWorkDate(e.target.value)} className="cm-input" />
          </Field>
          <Field label={t('record.scheduledStart')}>
            <input
              type="time"
              value={scheduledStart || preview?.scheduledStart || ''}
              onChange={(e) => setScheduledStart(e.target.value)}
              className="cm-input"
            />
          </Field>
          <Field label={t('record.cupsOverride')}>
            <div className="cm-row">
              <input
                type="checkbox"
                aria-label={t('record.cupsOverride')}
                checked={cupsOverride !== null}
                onChange={(e) => setCupsOverride(e.target.checked ? Math.max(1, preview?.cups ?? 1) : null)}
              />
              <Stepper
                label={t('record.cupsOverride')}
                value={cupsOverride ?? Math.max(1, preview?.cups ?? 1)}
                min={1}
                max={MAX_CUPS_PER_RECORD}
                disabled={cupsOverride === null}
                onChange={setCupsOverride}
              />
            </div>
          </Field>
          <Field label={t('record.note')}>
            <input type="text" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} className="cm-input" />
          </Field>
        </div>
      </details>

      <button type="submit" className="cm-button cm-button-primary" disabled={!preview || busy || blockedByDuplicate}>
        {cups > 0 ? `${t('record.submit')} · ☕ ${cups}` : t('record.submitOnTime')}
      </button>
    </form>
  );
}
