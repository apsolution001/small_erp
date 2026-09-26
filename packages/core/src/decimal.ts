import { Decimal as DecimalJs } from 'decimal.js';

/**
 * The one Decimal every Ekaro package uses for quantities, rates and percentages (ADR 0005).
 * 40 significant digits holds `numeric(20,6) × numeric(20,6)` exactly. ROUND_HALF_UP rounds
 * ties away from zero, so -2.5 → -3 (symmetric, as accountants expect on returns).
 * It is a clone, so configuring it never changes the global decimal.js used by other libraries.
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = DecimalJs;

/** A decimal value as it arrives: a Decimal, or a decimal string from JSON / the DB. */
export type DecimalLike = Decimal | string;

/** Largest scale stored for quantities and rates: `numeric(20,6)`. */
export const QTY_MAX_DECIMALS = 6;

const QTY_PATTERN = /^-?\d{1,14}(\.\d{1,6})?$/;
const RATE_PATTERN = /^\d{1,14}(\.\d{1,6})?$/;

/** Converts a DecimalLike to a finite Decimal. Throws on non-numeric or non-finite input. */
export function toDecimal(value: DecimalLike): Decimal {
  const d = typeof value === 'string' ? new Decimal(value) : value;
  if (!d.isFinite()) {
    throw new RangeError(`Expected a finite decimal, got ${d.toString()}`);
  }
  return d;
}

/** Parses a quantity string that fits `numeric(20,6)` (signed, ≤ 14 integer digits, ≤ 6 dp). */
export function parseQty(value: string): Decimal {
  if (!QTY_PATTERN.test(value)) {
    throw new RangeError(`Invalid quantity "${value}": expected a decimal with at most 6 places`);
  }
  return new Decimal(value);
}

/** Parses a unit-rate string (rupees per unit, `numeric(20,6)`, never negative). */
export function parseRate(value: string): Decimal {
  if (!RATE_PATTERN.test(value)) {
    throw new RangeError(`Invalid rate "${value}": expected a non-negative decimal, ≤ 6 places`);
  }
  return new Decimal(value);
}

/** Formats a quantity with exactly `dp` decimal places (0–6), rounding half up. */
export function formatQty(value: Decimal, dp: number): string {
  if (!Number.isInteger(dp) || dp < 0 || dp > QTY_MAX_DECIMALS) {
    throw new RangeError(`Decimal places must be an integer 0–${QTY_MAX_DECIMALS}, got ${dp}`);
  }
  return value.toFixed(dp, Decimal.ROUND_HALF_UP);
}
