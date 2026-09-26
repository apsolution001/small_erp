import { computeGstinChecksum, getState, GSTIN_PATTERN, isCurrentStateCode } from '@ekaro/core';

export const GSTIN_LENGTH = 15;

export type GstinCheck =
  | { status: 'empty' }
  | { status: 'incomplete'; remaining: number }
  | { status: 'invalid_format' }
  | { status: 'invalid_state'; stateCode: string }
  | { status: 'invalid_checksum' }
  | { status: 'valid'; stateCode: string; stateName: string };

/** Uppercases and drops spaces, the way people paste GSTINs from invoices. */
export function normalizeGstin(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase().slice(0, GSTIN_LENGTH);
}

/**
 * Live feedback while typing a GSTIN (spec 02 §1): the same rules as the contracts schema
 * (`@ekaro/core` format, current state code, mod-36 check character), told apart so the user
 * knows what to fix.
 */
export function checkGstin(value: string): GstinCheck {
  if (value === '') return { status: 'empty' };
  if (value.length < GSTIN_LENGTH) {
    return { status: 'incomplete', remaining: GSTIN_LENGTH - value.length };
  }
  if (!GSTIN_PATTERN.test(value)) return { status: 'invalid_format' };
  const stateCode = value.slice(0, 2);
  const state = getState(stateCode);
  if (!isCurrentStateCode(stateCode) || state === undefined) {
    return { status: 'invalid_state', stateCode };
  }
  if (computeGstinChecksum(value.slice(0, 14)) !== value.charAt(14)) {
    return { status: 'invalid_checksum' };
  }
  return { status: 'valid', stateCode, stateName: state.name };
}

export function gstinCheckMessage(check: GstinCheck): string {
  switch (check.status) {
    case 'empty':
      return '15 characters, e.g. 27AAPFU0939F1ZV';
    case 'incomplete':
      return `${String(check.remaining)} more character${check.remaining === 1 ? '' : 's'}`;
    case 'invalid_format':
      return 'Not a GSTIN: 2-digit state, 10-character PAN, entity number, Z, check character';
    case 'invalid_state':
      return `${check.stateCode} is not a current GST state code`;
    case 'invalid_checksum':
      return 'The check character does not match. Look for a typo';
    case 'valid':
      return `Valid GSTIN · ${check.stateCode} ${check.stateName}`;
  }
}
