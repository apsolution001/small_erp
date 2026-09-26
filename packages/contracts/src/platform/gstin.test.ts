import { describe, expect, it } from 'vitest';
import { gstinLookupParamsSchema, gstinLookupResponseSchema } from './gstin.js';

const lookup = {
  gstin: '27AAPFU0939F1ZV',
  legalName: 'AAPFU0939F Private Limited',
  tradeName: 'AAPFU0939F Traders',
  pan: 'AAPFU0939F',
  stateCode: '27',
  status: 'Active',
  address: {
    line1: 'Unit 0939, Industrial Estate',
    line2: null,
    city: 'Mumbai',
    pincode: '400001',
    stateCode: '27',
  },
};

describe('gstinLookupParamsSchema', () => {
  it('normalises the GSTIN and rejects a bad checksum', () => {
    expect(gstinLookupParamsSchema.parse({ gstin: '27aapfu0939f1zv' })).toEqual({
      gstin: '27AAPFU0939F1ZV',
    });
    expect(gstinLookupParamsSchema.safeParse({ gstin: '27AAPFU0939F1ZA' }).success).toBe(false);
  });
});

describe('gstinLookupResponseSchema', () => {
  it('parses a lookup result', () => {
    expect(gstinLookupResponseSchema.parse(lookup)).toEqual(lookup);
  });

  it('rejects a legacy state code (GSTINs use current codes only)', () => {
    expect(gstinLookupResponseSchema.safeParse({ ...lookup, stateCode: '28' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(gstinLookupResponseSchema.safeParse({ ...lookup, status: 'Gone' }).success).toBe(false);
  });
});
