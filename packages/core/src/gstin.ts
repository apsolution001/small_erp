import { isValidStateCode } from './states.js';

/** GSTIN format (spec 02 §1): state, PAN, entity number, `Z`, check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The mod-36 alphabet: a character's value is its index. */
export const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const BODY_PATTERN = /^[0-9A-Z]{14}$/;

/**
 * The GSTN check character for the first 14 characters (a Luhn mod-36 variant): weights
 * alternate 1, 2 from the left; each product contributes `floor(p / 36) + p % 36`; the check
 * value is `(36 - sum % 36) % 36`.
 */
export function computeGstinChecksum(first14: string): string {
  if (!BODY_PATTERN.test(first14)) {
    throw new RangeError(`Expected 14 characters of 0-9A-Z, got "${first14}"`);
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARSET.indexOf(first14.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET.charAt((36 - (sum % 36)) % 36);
}

/**
 * True when the value has the GSTIN format, a known state code and a correct check character.
 * The value must already be trimmed and upper-case (the contracts schema normalises input).
 */
export function isValidGstin(value: string): boolean {
  return (
    GSTIN_PATTERN.test(value) &&
    isValidStateCode(value.slice(0, 2)) &&
    computeGstinChecksum(value.slice(0, 14)) === value.charAt(14)
  );
}

function assertValid(gstin: string): void {
  if (!isValidGstin(gstin)) {
    throw new RangeError(`Invalid GSTIN "${gstin}"`);
  }
}

/** The GST state code (characters 1–2) of a valid GSTIN. */
export function gstinStateCode(gstin: string): string {
  assertValid(gstin);
  return gstin.slice(0, 2);
}

/** The PAN (characters 3–12) of a valid GSTIN. */
export function gstinPan(gstin: string): string {
  assertValid(gstin);
  return gstin.slice(2, 12);
}
