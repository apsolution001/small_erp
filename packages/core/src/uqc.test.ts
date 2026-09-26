import { describe, expect, it } from 'vitest';
import { UQCS, UQC_CODES, isValidUqc } from './uqc.js';

describe('UQC list', () => {
  it('has the 45 GST unit quantity codes plus NA, unique and sorted', () => {
    expect(UQC_CODES).toHaveLength(46);
    expect(new Set(UQC_CODES).size).toBe(46);
    expect([...UQC_CODES].sort()).toEqual([...UQC_CODES]);
    expect(UQCS.map((u) => u.code)).toEqual([...UQC_CODES]);
  });

  it('covers every unit seeded per tenant (spec 02 §4)', () => {
    const seeded = ['NOS', 'PCS', 'KGS', 'GMS', 'TON', 'MTR', 'CMS', 'LTR', 'MLT', 'BOX', 'BAG'];
    const seededMore = ['SET', 'PAC', 'ROL', 'SQM', 'SQF', 'DOZ', 'OTH'];
    for (const code of [...seeded, ...seededMore]) expect(isValidUqc(code), code).toBe(true);
  });

  it('describes each code', () => {
    expect(UQCS.find((u) => u.code === 'KGS')?.description).toBe('Kilograms');
    expect(UQCS.find((u) => u.code === 'NOS')?.description).toBe('Numbers');
    expect(UQCS.find((u) => u.code === 'OTH')?.description).toBe('Others');
  });

  it('has NA for services, as the GSTR-1 HSN summary reports them', () => {
    expect(isValidUqc('NA')).toBe(true);
    expect(UQCS.find((u) => u.code === 'NA')?.description).toBe('Not applicable (services)');
  });

  it('rejects unknown or lowercase codes', () => {
    for (const bad of ['kgs', 'KG', 'XYZ', '']) expect(isValidUqc(bad), bad).toBe(false);
  });
});
