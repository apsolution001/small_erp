import { describe, expect, it } from 'vitest';
import {
  DOC_NUMBER_MAX_LENGTH,
  formatDocNumber,
  maxDocNumber,
  seriesWidth,
  validateSeries,
} from './series.js';

const SI = { prefix: 'SI/26-27/', suffix: '', padding: 4 };

describe('formatDocNumber', () => {
  it('renders prefix + zero-padded number + suffix', () => {
    expect(formatDocNumber(SI, 1)).toBe('SI/26-27/0001');
    expect(formatDocNumber(SI, 1).length).toBe(13);
    expect(formatDocNumber({ prefix: 'INV-', suffix: '/A', padding: 3 }, 42n)).toBe('INV-042/A');
  });

  it('grows past the padding instead of truncating', () => {
    expect(formatDocNumber(SI, 12345n)).toBe('SI/26-27/12345');
    expect(formatDocNumber({ prefix: '', suffix: '', padding: 1 }, 9999999999999999n)).toBe(
      '9999999999999999',
    );
  });

  it('never renders a number longer than 16 characters (GST rule 46)', () => {
    expect(DOC_NUMBER_MAX_LENGTH).toBe(16);
    expect(formatDocNumber(SI, 9999999n)).toBe('SI/26-27/9999999');
    expect(() => formatDocNumber(SI, 10000000n)).toThrow(RangeError);
  });

  it('rejects non-positive or non-integer numbers and invalid series', () => {
    for (const n of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatDocNumber(SI, n), String(n)).toThrow(RangeError);
    }
    expect(() => formatDocNumber({ ...SI, prefix: 'SI 26' }, 1)).toThrow(RangeError);
  });
});

describe('validateSeries', () => {
  it('accepts the default series', () => {
    expect(validateSeries({ ...SI, nextNumber: 1n })).toEqual([]);
    expect(validateSeries({ prefix: '', suffix: '', padding: 1 })).toEqual([]);
    expect(validateSeries({ prefix: 'ABCDEFGHIJ', suffix: '/2627', padding: 1 })).toEqual([]); // 16
  });

  it('limits prefix to 10 and suffix to 6 characters', () => {
    expect(validateSeries({ ...SI, prefix: 'ABCDEFGHIJK' })).toContainEqual({
      code: 'PREFIX_TOO_LONG',
      field: 'prefix',
    });
    expect(validateSeries({ ...SI, suffix: '/2026-7' })).toContainEqual({
      code: 'SUFFIX_TOO_LONG',
      field: 'suffix',
    });
  });

  it('allows only A-Z a-z 0-9 / - in prefix and suffix', () => {
    expect(validateSeries({ ...SI, prefix: 'SI 26' })).toEqual([
      { code: 'INVALID_CHARACTERS', field: 'prefix' },
    ]);
    expect(validateSeries({ ...SI, suffix: '_A' })).toEqual([
      { code: 'INVALID_CHARACTERS', field: 'suffix' },
    ]);
    expect(validateSeries({ ...SI, prefix: 'SI#' })).toHaveLength(1);
  });

  it('requires padding 1–8 and a positive next number', () => {
    for (const padding of [0, 9, 1.5]) {
      expect(validateSeries({ ...SI, padding }), String(padding)).toEqual([
        { code: 'INVALID_PADDING', field: 'padding' },
      ]);
    }
    for (const nextNumber of [0, -1, 2.5]) {
      expect(validateSeries({ ...SI, nextNumber }), String(nextNumber)).toEqual([
        { code: 'INVALID_NEXT_NUMBER', field: 'nextNumber' },
      ]);
    }
  });

  it('rejects a series whose padded number exceeds 16 characters', () => {
    // 10 + 8 = 18: even number 1 renders as 18 characters.
    expect(validateSeries({ prefix: 'ABCDEFGHIJ', suffix: '', padding: 8 })).toEqual([
      { code: 'NUMBER_TOO_LONG', field: 'padding' },
    ]);
    // 9 + 4 + 3 = 16 is the limit and still valid; 17 is not.
    expect(validateSeries({ ...SI, suffix: '/AB' })).toEqual([]);
    expect(validateSeries({ ...SI, suffix: '/ABC' })).toEqual([
      { code: 'NUMBER_TOO_LONG', field: 'padding' },
    ]);
  });

  it('requires the first rendered character to be A-Z, a-z or 1-9 (e-invoice)', () => {
    for (const prefix of ['/SI', '-SI', '0SI']) {
      expect(validateSeries({ ...SI, prefix }), prefix).toEqual([
        { code: 'INVALID_FIRST_CHARACTER', field: 'prefix' },
      ]);
    }
    expect(validateSeries({ ...SI, prefix: '1SI/' })).toEqual([]);
    expect(validateSeries({ ...SI, prefix: 'si/' })).toEqual([]);
  });

  it('without a prefix, the padding must not render a leading zero', () => {
    const bare = { prefix: '', suffix: '/A', padding: 4 };
    expect(validateSeries(bare)).toEqual([{ code: 'INVALID_FIRST_CHARACTER', field: 'padding' }]);
    expect(validateSeries({ ...bare, nextNumber: 999n })).toEqual([
      { code: 'INVALID_FIRST_CHARACTER', field: 'padding' },
    ]);
    // From 1000 on, every number fills the padding, so none starts with 0.
    expect(validateSeries({ ...bare, nextNumber: 1000n })).toEqual([]);
    expect(() => formatDocNumber(bare, 7)).toThrow(RangeError);
    expect(formatDocNumber(bare, 1000)).toBe('1000/A');
  });

  it('rejects a next number that has outgrown the space left', () => {
    expect(validateSeries({ ...SI, nextNumber: 9999999n })).toEqual([]);
    expect(validateSeries({ ...SI, nextNumber: 10000000n })).toEqual([
      { code: 'NUMBER_TOO_LONG', field: 'nextNumber' },
    ]);
  });
});

describe('seriesWidth', () => {
  it('is the width of the largest of the padded capacity and the next number', () => {
    expect(seriesWidth(SI)).toBe(13);
    expect(seriesWidth({ ...SI, nextNumber: 123456n })).toBe(15);
    expect(seriesWidth({ ...SI, nextNumber: 99n })).toBe(13);
    expect(seriesWidth({ prefix: 'INV-', suffix: '/A', padding: 3, nextNumber: 5 })).toBe(9);
  });
});

describe('maxDocNumber', () => {
  it('is the largest number that still fits in 16 characters', () => {
    expect(maxDocNumber(SI)).toBe(9999999n);
    expect(maxDocNumber({ prefix: 'INV-', suffix: '/A', padding: 3 })).toBe(9999999999n);
    expect(maxDocNumber({ prefix: 'ABCDEFGHIJ', suffix: 'ABCDEF', padding: 1 })).toBe(0n);
  });
});
