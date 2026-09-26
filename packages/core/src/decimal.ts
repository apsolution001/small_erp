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
/** Largest number of integer digits stored for quantities and rates: `numeric(20,6)`. */
export const QTY_MAX_INTEGER_DIGITS = 20 - QTY_MAX_DECIMALS;

const NUMERIC_20_6 = `\\d{1,${QTY_MAX_INTEGER_DIGITS}}(\\.\\d{1,${QTY_MAX_DECIMALS}})?`;

/** A quantity string that fits `numeric(20,6)`: signed, ≤ 14 integer digits, ≤ 6 decimals. */
export const QTY_PATTERN = new RegExp(`^-?${NUMERIC_20_6}$`);
/** A unit-rate string that fits `numeric(20,6)` and is never negative. */
export const RATE_PATTERN = new RegExp(`^${NUMERIC_20_6}$`);

/** A plain decimal string: optional minus, digits, optional fraction. No exponent, hex or `+`. */
const PLAIN_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Converts a DecimalLike to a finite Decimal of the configured clone. Strings must be plain
 * decimals (`-12.50`); hex, binary, exponents, `Infinity` and `NaN` are rejected. An instance is
 * always re-wrapped, so a decimal.js instance built with another configuration (precision,
 * rounding) never leaks that configuration into Ekaro arithmetic. Re-wrapping copies the digits
 * exactly; it does not round.
 */
export function toDecimal(value: DecimalLike): Decimal {
  if (typeof value === 'string' && !PLAIN_DECIMAL_PATTERN.test(value)) {
    throw new RangeError(`Expected a plain decimal string, got "${value}"`);
  }
  const d = new Decimal(value);
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
export function formatQty(value: DecimalLike, dp: number): string {
  if (!Number.isInteger(dp) || dp < 0 || dp > QTY_MAX_DECIMALS) {
    throw new RangeError(`Decimal places must be an integer 0–${QTY_MAX_DECIMALS}, got ${dp}`);
  }
  return toDecimal(value).toFixed(dp, Decimal.ROUND_HALF_UP);
}
