import { type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useHotkey } from './hotkeys-context';

/** The controls Enter walks through, in DOM order (Radix selects and checkboxes are buttons). */
const FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=submit]):not([type=button])',
  'select',
  'textarea',
  'button[role=combobox]',
  'button[role=checkbox]',
]
  .map((s) => `${s}:not([disabled]):not([readonly])`)
  .join(',');

/**
 * Form `onKeyDown`: Enter moves to the next field, Tally style (BRD §5). On the last field it
 * does nothing special, so the browser submits the form. Enter in a textarea, on a button or
 * with a modifier keeps its normal meaning.
 */
export function focusNextFieldOnEnter(event: ReactKeyboardEvent<HTMLFormElement>): void {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (['checkbox', 'radio', 'submit', 'button'].includes(target.type)) return;
  const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
  const next = fields[fields.indexOf(target) + 1];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
}

export interface FormShortcuts {
  /** The form element; the shortcuts fire only while focus is inside it. */
  formRef: RefObject<HTMLFormElement | null>;
  onSave: () => void;
  onCancel?: () => void;
}

/** Ctrl+S saves and Esc cancels the focused form (frontend standard). */
export function useFormShortcuts({ formRef, onSave, onCancel }: FormShortcuts): void {
  const scope = () => formRef.current;
  useHotkey({
    id: 'form.save',
    keys: 'mod+s',
    description: 'Save the form',
    group: 'Forms',
    handler: onSave,
    scope,
  });
  useHotkey({
    id: 'form.cancel',
    keys: 'escape',
    description: 'Cancel and leave the form',
    group: 'Forms',
    allowInInputs: true,
    enabled: onCancel !== undefined,
    ...(onCancel ? { handler: onCancel } : {}),
    scope,
  });
}
