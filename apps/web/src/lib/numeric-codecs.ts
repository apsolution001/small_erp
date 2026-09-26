import {
  Money,
  PAISE_PATTERN,
  QTY_MAX_DECIMALS,
  QTY_MAX_INTEGER_DIGITS,
  QTY_PATTERN,
  toDecimal,
} from '@ekaro/core';
import { formatMoney, formatQty } from './format';

/** How a numeric field converts between its value (the payload) and what the user types. */
export interface NumericCodec {
  /** Accepts a partial entry while typing (`12.`, `-`), after grouping commas are removed. */
  accepts: RegExp;
  /** The value for a complete-enough draft, or `''` for an empty one. Never throws. */
  toValue: (draft: string) => string;
  /** The editable text for a value (no grouping). */
  toDraft: (value: string) => string;
  /** The value shown while the field is not focused (grouped, fixed decimals). */
  display: (value: string) => string;
}

/**
 * At most 15 rupee digits: far above any invoice, and well inside the `bigint` paise the API
 * stores (the contracts schema checks the exact range).
 */
const MAX_RUPEE_DIGITS = 15;

/** Drops what only makes sense mid-typing: a lone `-` or `.`, a trailing `.`; `.5` → `0.5`. */
function complete(draft: string): string {
  if (/^-?\.?$/.test(draft)) return '';
  const trimmed = draft.endsWith('.') ? draft.slice(0, -1) : draft;
  return trimmed.replace(/^(-?)\./, '$10.');
}

/** Rupees typed, integer paise string as the value (`"12345.5"` → `"1234550"`). */
export function moneyCodec(allowNegative: boolean): NumericCodec {
  const sign = allowNegative ? '-?' : '';
  return {
    accepts: new RegExp(`^${sign}\\d{0,${String(MAX_RUPEE_DIGITS)}}(\\.\\d{0,2})?$`),
    toValue: (draft) => {
      const rupees = complete(draft);
      return rupees === '' ? '' : Money.fromRupees(rupees).toJSON();
    },
    toDraft: (paise) => (PAISE_PATTERN.test(paise) ? Money.parse(paise).toRupeesString() : ''),
    display: (paise) => (PAISE_PATTERN.test(paise) ? formatMoney(paise, { symbol: false }) : ''),
  };
}

/** A quantity with at most the unit's decimals; the value is canonical decimal text. */
export function qtyCodec(decimals: number, allowNegative: boolean): NumericCodec {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > QTY_MAX_DECIMALS) {
    throw new RangeError(`Quantity decimals must be 0–${String(QTY_MAX_DECIMALS)}`);
  }
  const sign = allowNegative ? '-?' : '';
  const fraction = decimals === 0 ? '' : `(\\.\\d{0,${String(decimals)}})?`;
  return {
    accepts: new RegExp(`^${sign}\\d{0,${String(QTY_MAX_INTEGER_DIGITS)}}${fraction}$`),
    toValue: (draft) => {
      const qty = complete(draft);
      // Canonical text (`007.50` → `7.5`), so equal quantities compare equal.
      return qty === '' ? '' : toDecimal(qty).toFixed();
    },
    toDraft: (qty) => (QTY_PATTERN.test(qty) ? qty : ''),
    display: (qty) => (QTY_PATTERN.test(qty) ? formatQty(qty, decimals) : ''),
  };
}
