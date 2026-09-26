import { describe, expect, it } from 'vitest';
import { STATES, STATE_CODES, getState, isValidStateCode } from './states.js';

describe('STATES', () => {
  it('lists GST state codes 01–38 and 97, in code order, once each', () => {
    const expected = [
      ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')),
      '97',
    ];
    expect(STATE_CODES).toEqual(expected);
    expect(STATES.map((s) => s.code)).toEqual(expected);
  });

  it('carries the GST names', () => {
    expect(getState('01')?.name).toBe('Jammu and Kashmir');
    expect(getState('07')?.name).toBe('Delhi');
    expect(getState('24')?.name).toBe('Gujarat');
    expect(getState('26')?.name).toBe('Dadra and Nagar Haveli and Daman and Diu');
    expect(getState('27')?.name).toBe('Maharashtra');
    expect(getState('29')?.name).toBe('Karnataka');
    expect(getState('33')?.name).toBe('Tamil Nadu');
    expect(getState('36')?.name).toBe('Telangana');
    expect(getState('37')?.name).toBe('Andhra Pradesh');
    expect(getState('38')?.name).toBe('Ladakh');
    expect(getState('97')?.name).toBe('Other Territory');
  });

  it('marks union territories without a legislature as UTGST', () => {
    const utgst = STATES.filter((s) => s.levy === 'UTGST').map((s) => s.code);
    expect(utgst).toEqual(['04', '25', '26', '31', '35', '38', '97']);
    expect(getState('07')?.levy).toBe('SGST');
    expect(getState('34')?.levy).toBe('SGST');
    expect(getState('01')?.kind).toBe('union_territory');
    expect(getState('27')?.kind).toBe('state');
    expect(getState('97')?.kind).toBe('other_territory');
  });

  it('flags the pre-reorganisation codes 25 and 28 as legacy', () => {
    expect(STATES.filter((s) => s.legacy).map((s) => s.code)).toEqual(['25', '28']);
  });
});

describe('isValidStateCode', () => {
  it('accepts every listed code', () => {
    for (const code of STATE_CODES) expect(isValidStateCode(code)).toBe(true);
  });

  it('rejects unknown and malformed codes', () => {
    for (const bad of ['00', '39', '96', '99', '7', '027', '', 'MH']) {
      expect(isValidStateCode(bad), bad).toBe(false);
    }
    expect(getState('99')).toBeUndefined();
  });
});
