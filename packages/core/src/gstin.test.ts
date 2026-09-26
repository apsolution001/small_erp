import { describe, expect, it } from 'vitest';
import {
  GSTIN_CHARSET,
  GSTIN_PATTERN,
  computeGstinChecksum,
  gstinPan,
  gstinStateCode,
  isValidGstin,
} from './gstin.js';

const VALID = ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4'] as const;

describe('computeGstinChecksum (GSTN mod-36)', () => {
  it('computes the check character of known GSTINs', () => {
    expect(computeGstinChecksum('27AAPFU0939F1Z')).toBe('V');
    expect(computeGstinChecksum('29AAGCB7383J1Z')).toBe('4');
  });

  it('rejects input that is not 14 characters of 0-9A-Z', () => {
    for (const bad of ['27AAPFU0939F1', '27AAPFU0939F1ZV', '27aapfu0939f1z', '27AAPFU0939F1-']) {
      expect(() => computeGstinChecksum(bad), bad).toThrow(RangeError);
    }
  });
});

describe('isValidGstin', () => {
  it('accepts known valid GSTINs', () => {
    for (const gstin of VALID) expect(isValidGstin(gstin), gstin).toBe(true);
  });

  it('rejects a wrong check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZA')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z0')).toBe(false);
    expect(isValidGstin('29AAGCB7383J1Z5')).toBe(false);
  });

  it('detects every single-character substitution in the first 14 characters', () => {
    for (const gstin of VALID) {
      for (let i = 0; i < 14; i++) {
        for (const c of GSTIN_CHARSET) {
          if (c === gstin[i]) continue;
          const mutated = gstin.slice(0, i) + c + gstin.slice(i + 1);
          expect(isValidGstin(mutated), mutated).toBe(false);
        }
      }
    }
  });

  it('rejects malformed values even when the checksum would match', () => {
    const withChecksum = (first14: string): string => first14 + computeGstinChecksum(first14);
    expect(isValidGstin(withChecksum('27AAPFU0939F0Z'))).toBe(false); // 13th must be 1-9A-Z
    expect(isValidGstin(withChecksum('27AAPFU0939F1Y'))).toBe(false); // 14th must be Z
    expect(isValidGstin(withChecksum('27AAPF10939F1Z'))).toBe(false); // PAN letters
    expect(isValidGstin(withChecksum('99AAPFU0939F1Z'))).toBe(false); // unknown state code
    expect(isValidGstin(withChecksum('00AAPFU0939F1Z'))).toBe(false);
  });

  it('is strict about case, whitespace and length', () => {
    expect(isValidGstin('27aapfu0939f1zv')).toBe(false);
    expect(isValidGstin(' 27AAPFU0939F1ZV')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });

  it('exposes the format pattern from spec 02', () => {
    expect(GSTIN_PATTERN.source).toBe('^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  });
});

describe('gstinStateCode / gstinPan', () => {
  it('extracts the state code and PAN', () => {
    expect(gstinStateCode('27AAPFU0939F1ZV')).toBe('27');
    expect(gstinPan('27AAPFU0939F1ZV')).toBe('AAPFU0939F');
    expect(gstinStateCode('29AAGCB7383J1Z4')).toBe('29');
    expect(gstinPan('29AAGCB7383J1Z4')).toBe('AAGCB7383J');
  });

  it('refuses to read parts of an invalid GSTIN', () => {
    expect(() => gstinStateCode('27AAPFU0939F1ZA')).toThrow(RangeError);
    expect(() => gstinPan('not-a-gstin')).toThrow(RangeError);
  });
});
