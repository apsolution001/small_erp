import { describe, expect, it } from 'vitest';
import { Decimal, formatQty, parseQty, parseRate, toDecimal } from './decimal.js';

describe('Decimal', () => {
  it('is configured with precision 40 and ROUND_HALF_UP', () => {
    expect(Decimal.precision).toBe(40);
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it('rounds ties away from zero on both signs', () => {
    expect(new Decimal('2.5').toFixed(0)).toBe('3');
    expect(new Decimal('-2.5').toFixed(0)).toBe('-3');
    expect(new Decimal('2.45').toDecimalPlaces(1).toString()).toBe('2.5');
  });

  it('keeps 40 significant digits without float drift', () => {
    expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
    expect(new Decimal('12345678901234.123456').times('98765432109876.654321').toFixed()).toBe(
      '1219326311370175429262137875.264349853376',
    );
  });

  it('never switches to exponential notation for realistic magnitudes', () => {
    expect(new Decimal('0.000001').toString()).toBe('0.000001');
    expect(new Decimal('123456789012345678901234567890').toString()).toBe(
      '123456789012345678901234567890',
    );
  });
});

describe('toDecimal', () => {
  it('returns Decimal instances unchanged and parses strings', () => {
    const d = new Decimal('1.5');
    expect(toDecimal(d)).toBe(d);
    expect(toDecimal('0.4575').toString()).toBe('0.4575');
  });

  it('rejects non-numeric and non-finite strings', () => {
    expect(() => toDecimal('abc')).toThrow();
    expect(() => toDecimal('Infinity')).toThrow(RangeError);
    expect(() => toDecimal('NaN')).toThrow(RangeError);
  });
});

describe('parseQty', () => {
  it('parses signed decimal strings with up to 6 decimal places', () => {
    expect(parseQty('50').toString()).toBe('50');
    expect(parseQty('0.000001').toString()).toBe('0.000001');
    expect(parseQty('-12.5').toString()).toBe('-12.5');
    expect(parseQty('99999999999999.999999').toFixed()).toBe('99999999999999.999999');
  });

  it('rejects more than 6 decimal places, more than 14 integer digits, and junk', () => {
    for (const bad of ['1.0000001', '100000000000000', '', ' 1', '1e3', '1.', '.5', '+1', 'abc']) {
      expect(() => parseQty(bad), bad).toThrow(RangeError);
    }
  });
});

describe('parseRate', () => {
  it('parses non-negative decimal strings with up to 6 decimal places', () => {
    expect(parseRate('0.4575').toString()).toBe('0.4575');
    expect(parseRate('0').toString()).toBe('0');
  });

  it('rejects negative rates and more than 6 decimal places', () => {
    expect(() => parseRate('-1')).toThrow(RangeError);
    expect(() => parseRate('1.1234567')).toThrow(RangeError);
  });
});

describe('formatQty', () => {
  it('formats with a fixed number of decimal places, rounding half up', () => {
    expect(formatQty(new Decimal('1.23456'), 2)).toBe('1.23');
    expect(formatQty(new Decimal('1.235'), 2)).toBe('1.24');
    expect(formatQty(new Decimal('-1.235'), 2)).toBe('-1.24');
    expect(formatQty(new Decimal('50'), 3)).toBe('50.000');
    expect(formatQty(new Decimal('7.5'), 0)).toBe('8');
  });

  it('rejects decimal places outside 0–6', () => {
    expect(() => formatQty(new Decimal('1'), 7)).toThrow(RangeError);
    expect(() => formatQty(new Decimal('1'), -1)).toThrow(RangeError);
    expect(() => formatQty(new Decimal('1'), 1.5)).toThrow(RangeError);
  });
});
