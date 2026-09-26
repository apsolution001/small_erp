import { Decimal, type DecimalLike, toDecimal } from './decimal.js';

/** Money on the wire (ADR 0005): a string of integer paise such as `"1234550"`. */
export const PAISE_PATTERN = /^-?\d+$/;
const RUPEES_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** A ratio for {@link Money.allocate}: a non-negative Decimal, decimal string or bigint. */
export type AllocationRatio = DecimalLike | bigint;

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/**
 * An immutable amount of Indian rupees held as integer paise (ADR 0005).
 * All money arithmetic in Ekaro goes through this class; never use `number` for money.
 */
export class Money {
  static readonly ZERO = new Money(0n);

  private constructor(readonly paise: bigint) {
    Object.freeze(this);
  }

  static of(paise: bigint): Money {
    return paise === 0n ? Money.ZERO : new Money(paise);
  }

  /** Parses the JSON wire format: a string of integer paise such as `"1234550"`. */
  static parse(paise: string): Money {
    if (!PAISE_PATTERN.test(paise)) {
      throw new RangeError(`Invalid paise string "${paise}"`);
    }
    return Money.of(BigInt(paise));
  }

  /** Parses rupees such as `"12345.50"`. More than 2 decimal places is rejected, never rounded. */
  static fromRupees(rupees: string): Money {
    const match = RUPEES_PATTERN.exec(rupees);
    if (!match) {
      throw new RangeError(`Invalid rupee amount "${rupees}": expected at most 2 decimal places`);
    }
    const [, sign, whole = '0', fraction = ''] = match;
    const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return Money.of(sign === '-' ? -paise : paise);
  }

  static sum(amounts: readonly Money[]): Money {
    return Money.of(amounts.reduce((total, m) => total + m.paise, 0n));
  }

  add(other: Money): Money {
    return Money.of(this.paise + other.paise);
  }

  subtract(other: Money): Money {
    return Money.of(this.paise - other.paise);
  }

  negate(): Money {
    return Money.of(-this.paise);
  }

  abs(): Money {
    return Money.of(abs(this.paise));
  }

  /** Multiplies by a decimal factor and rounds ROUND_HALF_UP (ties away from zero) to the paise. */
  multiply(factor: DecimalLike): Money {
    return roundToPaise(new Decimal(this.paise.toString()).times(toDecimal(factor)));
  }

  /**
   * Splits this amount in proportion to `ratios` with the largest-remainder method: each part
   * gets the floor of its exact share, and the leftover paise go one each to the parts with the
   * largest remainders (ties go to the earlier part). The parts always sum back to this amount,
   * and a zero ratio never receives a paisa. A negative amount is split as its absolute value.
   * The arithmetic is exact: ratios are scaled to integers, so no precision limit applies.
   */
  allocate(ratios: readonly AllocationRatio[]): Money[] {
    const weights = toIntegerWeights(ratios);
    const weightSum = weights.reduce((a, b) => a + b, 0n);
    if (weightSum === 0n) {
      throw new RangeError('At least one allocation ratio must be positive');
    }
    const total = abs(this.paise);
    const shares = weights.map((w) => (total * w) / weightSum);
    const remainders = weights.map((w) => (total * w) % weightSum);
    // leftover < number of parts, so it always fits in a number.
    const leftover = Number(total - shares.reduce((a, b) => a + b, 0n));
    const bonus = new Set(
      remainders
        .map((remainder, index) => ({ remainder, index }))
        .sort((a, b) =>
          a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
        )
        .slice(0, leftover)
        .map(({ index }) => index),
    );
    const sign = this.paise < 0n ? -1n : 1n;
    return shares.map((share, index) => Money.of((bonus.has(index) ? share + 1n : share) * sign));
  }

  isZero(): boolean {
    return this.paise === 0n;
  }

  isNegative(): boolean {
    return this.paise < 0n;
  }

  isPositive(): boolean {
    return this.paise > 0n;
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.paise === other.paise) return 0;
    return this.paise < other.paise ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }

  /** Rupees with exactly two decimals and no grouping, e.g. `"-12345.50"`. */
  toRupeesString(): string {
    const magnitude = abs(this.paise);
    const sign = this.paise < 0n ? '-' : '';
    return `${sign}${(magnitude / 100n).toString()}.${(magnitude % 100n).toString().padStart(2, '0')}`;
  }

  /** JSON carries money as a paise string so no precision is lost (ADR 0005). */
  toJSON(): string {
    return this.paise.toString();
  }
}

/** Rounds a decimal number of paise ROUND_HALF_UP to a whole paisa. */
function roundToPaise(paise: Decimal): Money {
  return Money.of(BigInt(paise.toFixed(0, Decimal.ROUND_HALF_UP)));
}

function toIntegerWeights(ratios: readonly AllocationRatio[]): bigint[] {
  if (ratios.length === 0) {
    throw new RangeError('Cannot allocate over an empty list of ratios');
  }
  const decimals = ratios.map((r) =>
    typeof r === 'bigint' ? new Decimal(r.toString()) : toDecimal(r),
  );
  if (decimals.some((d) => d.isNegative())) {
    throw new RangeError('Allocation ratios must not be negative');
  }
  const scale = new Decimal(10).pow(Math.max(...decimals.map((d) => d.decimalPlaces())));
  return decimals.map((d) => BigInt(d.times(scale).toFixed(0)));
}

/**
 * Line amount in paise: `round_half_up(qty × rate × 100)` (accounting standard). Discounts are
 * applied by the caller on the returned Money, which gives the taxable value.
 */
export function lineAmount(qty: DecimalLike, rate: DecimalLike): Money {
  return roundToPaise(toDecimal(qty).times(toDecimal(rate)).times(100));
}

export interface FormatInrOptions {
  /** Prefix the rupee symbol (default true). Dense tables turn it off. */
  readonly symbol?: boolean;
}

/** Formats with Indian digit grouping: `₹12,34,567.50`, negatives as `-₹12,34,567.50`. */
export function formatINR(money: Money, options: FormatInrOptions = {}): string {
  const [rupees = '0', paise = '00'] = money.abs().toRupeesString().split('.');
  const lastThree = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${lastThree}` : lastThree;
  const sign = money.isNegative() ? '-' : '';
  const symbol = options.symbol === false ? '' : '₹';
  return `${sign}${symbol}${grouped}.${paise}`;
}
