import {
  computeCups,
  judgeLateness,
  MAX_CUPS_PER_RECORD,
  rulesetAt,
  type EventId,
  type LateChanges,
} from '@coffee/core';
import { useState } from 'react';
import { useCommand, useLedger, useT, useUi } from './context';
import { Field, Sheet, Stepper } from './primitives';

interface CorrectSheetProps {
  targetId: EventId | null;
  onOpenChange: (open: boolean) => void;
  /** A correction that would leave zero cups is really a waiver; hand over to the vote. */
  onProposeWaive: (targetId: EventId) => void;
}

export function CorrectSheet(props: CorrectSheetProps) {
  const t = useT();
  return (
    <Sheet open={props.targetId !== null} onOpenChange={props.onOpenChange} title={t('correct.title')}>
      {props.targetId && <CorrectForm key={props.targetId} {...props} targetId={props.targetId} />}
    </Sheet>
  );
}

function CorrectForm({ targetId, onOpenChange, onProposeWaive }: CorrectSheetProps & { targetId: EventId }) {
  const t = useT();
  const { toast } = useUi();
  const run = useCommand();
  const ledger = useLedger((s) => s.ledger);
  const rec = ledger.lates[targetId];

  const [arrivedAt, setArrivedAt] = useState(rec?.arrivedAt ?? '');
  const [scheduledStart, setScheduledStart] = useState(rec?.scheduledStart ?? '');
  const [cups, setCups] = useState(rec?.cups ?? 1);
  const [cupsTouched, setCupsTouched] = useState(false);
  const [note, setNote] = useState(rec?.note ?? '');
  const [reason, setReason] = useState('');
  if (!rec) return null;

  // Mirrors core's correctLate so the user sees the outcome before submitting.
  const rs = rulesetAt(ledger, rec.workDate);
  const judgement = judgeLateness(arrivedAt || rec.arrivedAt, scheduledStart || rec.scheduledStart, rs.graceMinutes);
  const timeChanged = arrivedAt !== rec.arrivedAt || scheduledStart !== rec.scheduledStart;
  const resulting = cupsTouched ? cups : timeChanged && !rec.cupsOverridden ? computeCups(judgement, rs.cupRule) : rec.cups;
  const toZero = resulting < 1;

  async function submit() {
    const changes: LateChanges = {};
    if (arrivedAt !== rec!.arrivedAt) changes.arrivedAt = arrivedAt;
    if (scheduledStart !== rec!.scheduledStart) changes.scheduledStart = scheduledStart;
    if (cupsTouched && cups !== rec!.cups) changes.cups = cups;
    if (note.trim() !== (rec!.note ?? '')) changes.note = note;
    const d = await run({ type: 'CorrectLate', targetId, changes, ...(reason.trim() && { reason }) });
    if (d.ok) {
      toast(t('correct.done'));
      onOpenChange(false);
    }
  }

  return (
    <form
      className="cm-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={t('record.arrivedAt')}>
        <input type="time" required value={arrivedAt} onChange={(e) => setArrivedAt(e.target.value)} className="cm-input cm-input-time" />
      </Field>
      <Field label={t('record.scheduledStart')}>
        <input type="time" required value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} className="cm-input" />
      </Field>
      <Field label={t('record.cupsOverride')}>
        <Stepper
          label={t('record.cupsOverride')}
          value={cupsTouched ? cups : Math.max(0, resulting)}
          min={0}
          max={MAX_CUPS_PER_RECORD}
          onChange={(v) => {
            setCups(v);
            setCupsTouched(true);
          }}
        />
      </Field>
      <Field label={t('record.note')}>
        <input type="text" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} className="cm-input" />
      </Field>
      <Field label={t('correct.reason')}>
        <input type="text" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} className="cm-input" />
      </Field>

      <div className={`cm-preview ${toZero ? 'is-ontime' : 'is-late'}`} role="status">
        <div className="cm-preview-main">
          {toZero ? t('correct.toZero') : t('record.previewLate', { minutes: judgement.minutesLate, cups: resulting })}
        </div>
      </div>

      {toZero ? (
        <button type="button" className="cm-button cm-button-primary" onClick={() => onProposeWaive(targetId)}>
          {t('ledger.propose')}
        </button>
      ) : (
        <button type="submit" className="cm-button cm-button-primary">
          {t('correct.submit')}
        </button>
      )}
    </form>
  );
}
