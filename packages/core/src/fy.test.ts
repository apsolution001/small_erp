import { describe, expect, it } from 'vitest';
import { currentFy, fyOf, fyRange, fyShort, isValidFyLabel } from './fy.js';

describe('fyOf', () => {
  it('maps plain dates to the Indian financial year (April–March)', () => {
    expect(fyOf('2026-04-01')).toBe('2026-27');
    expect(fyOf('2026-09-26')).toBe('2026-27');
    expect(fyOf('2027-03-31')).toBe('2026-27');
    expect(fyOf('2026-03-31')).toBe('2025-26');
    expect(fyOf('2026-01-01')).toBe('2025-26');
  });

  it('handles century boundaries and leap days', () => {
    expect(fyOf('2099-04-01')).toBe('2099-00');
    expect(fyOf('2000-01-01')).toBe('1999-00');
    expect(fyOf('2028-02-29')).toBe('2027-28');
  });

  it('reads Date instants on the Indian calendar (IST, UTC+05:30)', () => {
    expect(fyOf(new Date('2026-03-31T18:29:59.999Z'))).toBe('2025-26'); // 23:59:59.999 IST
    expect(fyOf(new Date('2026-03-31T18:30:00.000Z'))).toBe('2026-27'); // 00:00 IST, 1 April
  });

  it('rejects invalid dates', () => {
    for (const bad of [
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '26-04-01',
      'x',
      '',
    ]) {
      expect(() => fyOf(bad), bad).toThrow(RangeError);
    }
    expect(() => fyOf(new Date('not a date'))).toThrow(RangeError);
  });
});

describe('fyRange', () => {
  it('returns the first and last date of the year', () => {
    expect(fyRange('2026-27')).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    expect(fyRange('2099-00')).toEqual({ start: '2099-04-01', end: '2100-03-31' });
  });

  it('rejects malformed or inconsistent labels', () => {
    for (const bad of ['2026-28', '2026-2027', '26-27', '2099-01', '2026/27', '']) {
      expect(() => fyRange(bad), bad).toThrow(RangeError);
    }
  });
});

describe('fyShort', () => {
  it('shortens the label for document prefixes', () => {
    expect(fyShort('2026-27')).toBe('26-27');
    expect(fyShort('2099-00')).toBe('99-00');
    expect(() => fyShort('2026-28')).toThrow(RangeError);
  });
});

describe('isValidFyLabel', () => {
  it('accepts consecutive-year labels only', () => {
    expect(isValidFyLabel('2026-27')).toBe(true);
    expect(isValidFyLabel('1999-00')).toBe(true);
    expect(isValidFyLabel('2026-26')).toBe(false);
    expect(isValidFyLabel('2026-27 ')).toBe(false);
  });
});

describe('currentFy', () => {
  it('uses the given clock', () => {
    expect(currentFy(new Date('2026-09-26T10:00:00Z'))).toBe('2026-27');
    expect(currentFy(new Date('2027-02-01T10:00:00Z'))).toBe('2026-27');
  });

  it('defaults to now', () => {
    expect(currentFy()).toBe(fyOf(new Date()));
  });
});
