import { Money } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatQty } from './format';

describe('formatMoney', () => {
  it('formats paise strings with Indian grouping and the rupee symbol', () => {
    expect(formatMoney('123456750')).toBe('₹12,34,567.50');
    expect(formatMoney('0')).toBe('₹0.00');
    expect(formatMoney('5')).toBe('₹0.05');
    expect(formatMoney('-100000000')).toBe('-₹10,00,000.00');
  });

  it('keeps every paisa of amounts beyond the float range', () => {
    expect(formatMoney('9223372036854775807')).toBe('₹92,23,37,20,36,85,47,758.07');
  });

  it('drops the symbol for dense columns and accepts a Money', () => {
    expect(formatMoney(Money.fromRupees('1234.5'), { symbol: false })).toBe('1,234.50');
  });

  it('rejects anything that is not a paise string', () => {
    expect(() => formatMoney('12.50')).toThrow(RangeError);
  });
});

describe('formatQty', () => {
  it('fixes the unit decimals (half up) and groups the Indian way', () => {
    expect(formatQty('1234567.5', 3)).toBe('12,34,567.500');
    expect(formatQty('2.0005', 3)).toBe('2.001');
    expect(formatQty('10', 0)).toBe('10');
    expect(formatQty('12345678901234.123456', 6)).toBe('1,23,45,67,89,01,234.123456');
  });

  it('keeps the sign, including on values that round to a small negative', () => {
    expect(formatQty('-1500.25', 2)).toBe('-1,500.25');
    expect(formatQty('-0.5', 1)).toBe('-0.5');
  });
});

describe('formatDate', () => {
  it('shows calendar dates as dd-MMM-yyyy without shifting the day', () => {
    expect(formatDate('2026-09-26')).toBe('26-Sep-2026');
    expect(formatDate('2027-03-01')).toBe('01-Mar-2027');
  });

  it('reads instants in IST', () => {
    // 20:00 UTC is 01:30 the next day in India.
    expect(formatDate('2026-09-26T20:00:00.000Z')).toBe('27-Sep-2026');
    expect(formatDate(new Date('2026-01-31T18:29:59.000Z'))).toBe('31-Jan-2026');
  });

  it('rejects an invalid date', () => {
    expect(() => formatDate('not a date')).toThrow(RangeError);
    expect(() => formatDate('2026-13-01')).toThrow(RangeError);
  });
});
