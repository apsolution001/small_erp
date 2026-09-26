import { describe, expect, it } from 'vitest';
import {
  CURRENT_STATE_CODES,
  LEGACY_STATE_CODES,
  NON_STATE_PLACES_OF_SUPPLY,
  PLACE_OF_SUPPLY_CODES,
  STATES,
  STATE_CODES,
  getState,
  isCurrentStateCode,
  isValidPlaceOfSupply,
  isValidStateCode,
} from './states.js';

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
    expect(LEGACY_STATE_CODES).toEqual(['25', '28']);
    expect(STATES.filter((s) => s.legacy).map((s) => s.code)).toEqual([...LEGACY_STATE_CODES]);
  });
});

describe('current state codes', () => {
  it('are every state code except the legacy ones', () => {
    expect(CURRENT_STATE_CODES).toEqual(STATE_CODES.filter((c) => c !== '25' && c !== '28'));
    expect(CURRENT_STATE_CODES).toHaveLength(37);
  });

  it('isCurrentStateCode rejects legacy, place-of-supply-only and unknown codes', () => {
    expect(isCurrentStateCode('26')).toBe(true);
    expect(isCurrentStateCode('97')).toBe(true);
    for (const bad of ['25', '28', '96', '99', '00', '']) {
      expect(isCurrentStateCode(bad), bad).toBe(false);
    }
  });
});

describe('place of supply codes', () => {
  it('are the current state codes plus 96 (Other Countries) and 99 (Centre Jurisdiction)', () => {
    expect(NON_STATE_PLACES_OF_SUPPLY).toEqual([
      { code: '96', name: 'Other Countries' },
      { code: '99', name: 'Centre Jurisdiction' },
    ]);
    expect(PLACE_OF_SUPPLY_CODES).toEqual([...CURRENT_STATE_CODES, '96', '99']);
  });

  it('isValidPlaceOfSupply accepts 96 and 99 but not legacy codes', () => {
    for (const code of ['27', '97', '96', '99'])
      expect(isValidPlaceOfSupply(code), code).toBe(true);
    for (const bad of ['25', '28', '98', '39', '']) {
      expect(isValidPlaceOfSupply(bad), bad).toBe(false);
    }
  });

  it('96 and 99 are not states', () => {
    expect(isValidStateCode('96')).toBe(false);
    expect(getState('99')).toBeUndefined();
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
