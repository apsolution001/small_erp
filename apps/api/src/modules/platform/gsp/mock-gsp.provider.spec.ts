import { gstinLookupResponseSchema } from '@ekaro/contracts';
import { computeGstinChecksum } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { MockGspProvider } from './mock-gsp.provider.js';

const gstin = (state: string, pan: string): string => {
  const body = `${state}${pan}1Z`;
  return `${body}${computeGstinChecksum(body)}`;
};

describe('MockGspProvider', () => {
  const gsp = new MockGspProvider();

  it('derives state, names and address from the GSTIN, deterministically', async () => {
    const result = await gsp.lookupGstin(gstin('27', 'AAPCU0939F'));
    expect(result).toEqual({
      gstin: gstin('27', 'AAPCU0939F'),
      legalName: 'AAPCU0939F Private Limited',
      tradeName: 'AAPCU0939F Traders',
      pan: 'AAPCU0939F',
      stateCode: '27',
      status: 'Active',
      address: {
        line1: 'Unit 0939, Industrial Estate',
        line2: null,
        city: 'Maharashtra',
        pincode: '109390',
        stateCode: '27',
      },
    });
    expect(await gsp.lookupGstin(gstin('27', 'AAPCU0939F'))).toEqual(result);
    expect(gstinLookupResponseSchema.parse(result)).toEqual(result);
  });

  it('names the business by PAN holder type', async () => {
    expect((await gsp.lookupGstin(gstin('24', 'AAPFU0939F'))).legalName).toBe(
      'AAPFU0939F and Associates',
    );
    expect((await gsp.lookupGstin(gstin('24', 'ABCPK1234L'))).legalName).toBe(
      'ABCPK1234L Enterprises',
    );
  });

  it('reports Cancelled for PANs starting with ZZZZZ', async () => {
    const result = await gsp.lookupGstin(gstin('07', 'ZZZZZ1234Z'));
    expect(result.status).toBe('Cancelled');
    expect(result.address).toMatchObject({ city: 'Delhi', stateCode: '07', pincode: '812340' });
    expect(gstinLookupResponseSchema.safeParse(result).success).toBe(true);
  });
});
