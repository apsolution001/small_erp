import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal.js';
import { Money, PAISE_PATTERN, formatINR, lineAmount } from './money.js';

const paiseOf = (list: readonly Money[]): bigint[] => list.map((m) => m.paise);

describe('Money construction', () => {
  it('wraps bigint paise', () => {
    expect(Money.of(123450n).paise).toBe(123450n);
    expect(Money.ZERO.paise).toBe(0n);
  });

  it('is immutable', () => {
    const m = Money.of(100n);
    expect(Object.isFrozen(m)).toBe(true);
    m.add(Money.of(1n));
    expect(m.paise).toBe(100n);
  });

  it('parses rupee strings with up to 2 decimal places', () => {
    expect(Money.fromRupees('12345.5').paise).toBe(1234550n);
    expect(Money.fromRupees('12345.50').paise).toBe(1234550n);
    expect(Money.fromRupees('0.05').paise).toBe(5n);
    expect(Money.fromRupees('-0.05').paise).toBe(-5n);
    expect(Money.fromRupees('-10').paise).toBe(-1000n);
    expect(Money.fromRupees('92233720368547758.07').paise).toBe(9223372036854775807n);
  });

  it('rejects rupee strings that are not exact paise', () => {
    for (const bad of ['1.005', '', '1,000', 'abc', '1.', '.5', '+1', ' 1', '1e3']) {
      expect(() => Money.fromRupees(bad), bad).toThrow(RangeError);
    }
  });

  it('parses paise strings (the JSON wire format)', () => {
    expect(Money.parse('1234550').paise).toBe(1234550n);
    expect(Money.parse('-5').paise).toBe(-5n);
    expect(Money.parse('0').paise).toBe(0n);
    expect(Money.parse('123456789012345678901234567890').paise).toBe(
      123456789012345678901234567890n,
    );
  });

  it('exposes the paise wire pattern', () => {
    expect(PAISE_PATTERN.source).toBe(String.raw`^-?\d+$`);
  });

  it('rejects paise strings that are not integers', () => {
    for (const bad of ['1.5', '', 'abc', '1e3', ' 1', '+1', '--1']) {
      expect(() => Money.parse(bad), bad).toThrow(RangeError);
    }
  });
});

describe('Money serialisation', () => {
  it('serialises to a paise string in JSON', () => {
    expect(JSON.stringify({ amount: Money.of(1234550n) })).toBe('{"amount":"1234550"}');
    expect(Money.of(-5n).toJSON()).toBe('-5');
  });

  it('round-trips through JSON beyond 2^53', () => {
    const big = Money.of(2n ** 62n + 1n);
    expect(Money.parse(big.toJSON()).paise).toBe(4611686018427387905n);
  });

  it('renders rupee strings with exactly 2 decimal places', () => {
    expect(Money.of(1234550n).toRupeesString()).toBe('12345.50');
    expect(Money.of(5n).toRupeesString()).toBe('0.05');
    expect(Money.of(-5n).toRupeesString()).toBe('-0.05');
    expect(Money.of(-100n).toRupeesString()).toBe('-1.00');
    expect(Money.ZERO.toRupeesString()).toBe('0.00');
  });
});

describe('Money arithmetic', () => {
  it('adds, subtracts and negates exactly', () => {
    expect(Money.of(150n).add(Money.of(275n)).paise).toBe(425n);
    expect(Money.of(150n).subtract(Money.of(275n)).paise).toBe(-125n);
    expect(Money.of(150n).negate().paise).toBe(-150n);
    expect(Money.of(-150n).abs().paise).toBe(150n);
    expect(Money.of(150n).abs().paise).toBe(150n);
  });

  it('stays exact beyond Number.MAX_SAFE_INTEGER', () => {
    const a = Money.of(9007199254740993n);
    expect(a.add(Money.of(2n)).paise).toBe(9007199254740995n);
  });

  it('multiplies by a Decimal and rounds HALF_UP to the paise', () => {
    expect(Money.of(100n).multiply(new Decimal('0.125')).paise).toBe(13n); // 12.5
    expect(Money.of(100n).multiply(new Decimal('0.124')).paise).toBe(12n); // 12.4
    expect(Money.of(-100n).multiply(new Decimal('0.125')).paise).toBe(-13n); // -12.5
    expect(Money.of(1n).multiply('0.5').paise).toBe(1n);
    expect(Money.of(1n).multiply('0.49').paise).toBe(0n);
    expect(Money.of(1234567n).multiply('1.18').paise).toBe(1456789n); // 1456789.06
  });

  it('multiplies huge amounts exactly', () => {
    expect(Money.of(9223372036854775807n).multiply('0.18').paise).toBe(1660206966633859645n); // …645.26
  });

  it('sums a list (empty list is zero)', () => {
    expect(Money.sum([Money.of(1n), Money.of(2n), Money.of(-4n)]).paise).toBe(-1n);
    expect(Money.sum([]).paise).toBe(0n);
  });
});

describe('Money comparison', () => {
  it('reports sign', () => {
    expect(Money.ZERO.isZero()).toBe(true);
    expect(Money.of(-1n).isNegative()).toBe(true);
    expect(Money.of(-1n).isPositive()).toBe(false);
    expect(Money.of(1n).isPositive()).toBe(true);
    expect(Money.of(1n).isZero()).toBe(false);
    expect(Money.ZERO.isNegative()).toBe(false);
  });

  it('compares and tests equality by value', () => {
    expect(Money.of(1n).compare(Money.of(2n))).toBe(-1);
    expect(Money.of(2n).compare(Money.of(2n))).toBe(0);
    expect(Money.of(3n).compare(Money.of(2n))).toBe(1);
    expect(Money.of(2n).equals(Money.parse('2'))).toBe(true);
    expect(Money.of(2n).equals(Money.of(3n))).toBe(false);
  });
});

describe('Money.allocate (largest remainder)', () => {
  it('splits evenly and gives leftover paise to the largest remainders', () => {
    expect(paiseOf(Money.of(100n).allocate(['1', '1', '1']))).toEqual([34n, 33n, 33n]);
    expect(paiseOf(Money.of(10n).allocate(['1', '2']))).toEqual([3n, 7n]); // 3.33 / 6.67
  });

  it('breaks remainder ties by position', () => {
    expect(paiseOf(Money.of(5n).allocate(['0.3', '0.7']))).toEqual([2n, 3n]); // 1.5 / 3.5
  });

  it('never gives paise to a zero ratio', () => {
    expect(paiseOf(Money.of(1001n).allocate(['1', '0', '1']))).toEqual([501n, 0n, 500n]);
  });

  it('allocates negative totals symmetrically', () => {
    expect(paiseOf(Money.of(-100n).allocate(['1', '1', '1']))).toEqual([-34n, -33n, -33n]);
  });

  it('accepts Decimal and bigint ratios', () => {
    expect(paiseOf(Money.of(1000n).allocate([new Decimal('1.5'), 3n]))).toEqual([333n, 667n]); // 333.33 / 666.67
  });

  it('allocates zero into zeros', () => {
    expect(paiseOf(Money.ZERO.allocate(['1', '2']))).toEqual([0n, 0n]);
  });

  it('rejects empty, negative, non-finite and all-zero ratios', () => {
    expect(() => Money.of(1n).allocate([])).toThrow(RangeError);
    expect(() => Money.of(1n).allocate(['1', '-1'])).toThrow(RangeError);
    expect(() => Money.of(1n).allocate(['0', '0'])).toThrow(RangeError);
    expect(() => Money.of(1n).allocate(['Infinity'])).toThrow(RangeError);
  });

  it('always sums back to the total and stays within 1 paise of the exact share', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const parts = Money.of(total).allocate(weights.map(String));
          expect(Money.sum(parts).paise).toBe(total);
          const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
          parts.forEach((part, i) => {
            const exactScaled = total * BigInt(weights[i]!); // share × weightSum
            const diff = part.paise * weightSum - exactScaled;
            expect(diff < 0n ? -diff : diff).toBeLessThan(weightSum);
          });
        },
      ),
    );
  });
});

describe('Money properties', () => {
  const money = fc.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }).map((p) => Money.of(p));

  it('add/subtract are inverse and add is commutative', () => {
    fc.assert(
      fc.property(money, money, (a, b) => {
        expect(a.add(b).subtract(b).paise).toBe(a.paise);
        expect(a.add(b).paise).toBe(b.add(a).paise);
      }),
    );
  });

  it('multiply by 1 is identity and JSON round-trips', () => {
    fc.assert(
      fc.property(money, (a) => {
        expect(a.multiply('1').paise).toBe(a.paise);
        expect(Money.parse(a.toJSON()).paise).toBe(a.paise);
      }),
    );
  });
});

describe('formatINR', () => {
  it('uses Indian digit grouping with the rupee symbol', () => {
    expect(formatINR(Money.of(123456750n))).toBe('₹12,34,567.50');
    expect(formatINR(Money.ZERO)).toBe('₹0.00');
    expect(formatINR(Money.of(5n))).toBe('₹0.05');
    expect(formatINR(Money.of(99999n))).toBe('₹999.99');
    expect(formatINR(Money.of(100000n))).toBe('₹1,000.00');
    expect(formatINR(Money.of(10000000n))).toBe('₹1,00,000.00');
    expect(formatINR(Money.of(1000000000000n))).toBe('₹10,00,00,00,000.00');
  });

  it('puts the sign before the symbol for negative amounts', () => {
    expect(formatINR(Money.of(-123456750n))).toBe('-₹12,34,567.50');
  });

  it('can omit the symbol for dense tables', () => {
    expect(formatINR(Money.of(123456750n), { symbol: false })).toBe('12,34,567.50');
    expect(formatINR(Money.of(-5n), { symbol: false })).toBe('-0.05');
  });
});

describe('lineAmount', () => {
  it('computes round_half_up(qty × rate × 100) in paise', () => {
    expect(lineAmount('10', '12.5').paise).toBe(12500n);
    expect(lineAmount(new Decimal('3'), new Decimal('0.4575')).paise).toBe(137n); // 137.25
    expect(lineAmount('1', '0.005').paise).toBe(1n); // exactly 0.5 paise rounds up
    expect(lineAmount('1', '0.004999').paise).toBe(0n);
    expect(lineAmount('2.5', '0.333333').paise).toBe(83n); // 83.33325
  });

  it('rounds negative quantities (returns) symmetrically', () => {
    expect(lineAmount('-1', '0.005').paise).toBe(-1n);
    expect(lineAmount('-3', '0.4575').paise).toBe(-137n);
  });

  it('is exact for amounts far beyond 2^53 paise', () => {
    expect(lineAmount('99999999999999.999999', '99999999999999.999999').paise).toBe(
      999999999999999999980000000000n,
    );
  });
});
