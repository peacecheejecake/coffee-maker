import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { useT } from './context';

/** Bottom sheet on phones, side panel on wide screens (see ui.css). Built on Radix Dialog for focus/a11y. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const t = useT();
  // While the closing animation runs, keep showing what was there: callers usually render their body only
  // while open (`{open && …}`) and derive the title from the selection that was just cleared.
  const shown = useRef({ title, description, children });
  if (open) shown.current = { title, description, children };
  const view = shown.current;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cm-overlay" />
        <Dialog.Content className="cm-sheet" aria-describedby={view.description ? undefined : undefined}>
          <header className="cm-sheet-header">
            <Dialog.Title className="cm-sheet-title">{view.title}</Dialog.Title>
            <Dialog.Close className="cm-icon-button" aria-label={t('action.close')}>
              ✕
            </Dialog.Close>
          </header>
          {view.description ? (
            <Dialog.Description className="cm-sheet-description">{view.description}</Dialog.Description>
          ) : (
            <Dialog.Description className="cm-visually-hidden">{view.title}</Dialog.Description>
          )}
          <div className="cm-sheet-body">{view.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="cm-stepper" role="group" aria-label={label}>
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} aria-label={`${label} −`}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} aria-label={`${label} +`}>
        +
      </button>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="cm-field">
      <span className="cm-field-label">{label}</span>
      {children}
      {hint && <span className="cm-field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="cm-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorDot({ color }: { color: string }) {
  return <span className="cm-dot" style={{ background: color }} aria-hidden />;
}

/** Inline "are you sure?" box, the app's pattern for consequential actions (instead of window.confirm). */
export function ConfirmBox({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="cm-warning" role="alert">
      <p>{message}</p>
      <div className="cm-row">
        <button type="button" className="cm-button cm-button-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="cm-button cm-button-ghost" onClick={onCancel}>
          {t('action.cancel')}
        </button>
      </div>
    </div>
  );
}
