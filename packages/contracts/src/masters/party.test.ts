import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import {
  partyCreateSchema,
  partyListQuerySchema,
  partyRecordSchema,
  partyResponseSchema,
  partyUpdateSchema,
} from './party.js';

const billing = {
  kind: 'billing',
  line1: 'Plot 4, MIDC',
  city: 'Pune',
  stateCode: '27',
  pincode: '411019',
  isDefault: true,
};

const regular = {
  code: 'C-001',
  name: 'Umiya Steel',
  partyType: 'customer',
  gstRegistrationType: 'regular',
  gstin: '27AAPFU0939F1ZV',
  addresses: [billing],
};

const meta = {
  id: uuidv7(),
  version: 2,
  createdAt: '2026-04-01T04:30:00.000Z',
  updatedAt: '2026-09-26T10:15:00.123Z',
};

/** A party as `GET /parties/:id` returns it. */
const existing = {
  ...meta,
  ...regular,
  pan: 'AAPFU0939F',
  creditLimit: '5000000',
  creditDays: 30,
  paymentTerms: null,
  contactPerson: 'Ramesh',
  email: null,
  phone: null,
  notes: null,
  isActive: true,
  addresses: [
    {
      id: uuidv7(),
      ...billing,
      label: 'Head office',
      line2: null,
      country: 'IN',
    },
  ],
};

describe('partyCreateSchema', () => {
  it('applies defaults to the party and its addresses', () => {
    expect(partyCreateSchema.parse(regular)).toEqual({
      ...regular,
      pan: null,
      creditLimit: null,
      creditDays: null,
      paymentTerms: null,
      contactPerson: null,
      email: null,
      phone: null,
      notes: null,
      isActive: true,
      addresses: [{ ...billing, label: null, line2: null, country: 'IN' }],
    });
  });

  it('requires a GSTIN for regular, composition and SEZ parties', () => {
    for (const gstRegistrationType of ['regular', 'composition', 'sez']) {
      expect(
        pathsOf(partyCreateSchema.safeParse({ ...regular, gstRegistrationType, gstin: null })),
        gstRegistrationType,
      ).toEqual(['gstin']);
    }
  });

  it('forbids a GSTIN for unregistered, consumer and overseas parties', () => {
    for (const gstRegistrationType of ['unregistered', 'consumer', 'overseas']) {
      expect(
        pathsOf(partyCreateSchema.safeParse({ ...regular, gstRegistrationType })),
        gstRegistrationType,
      ).toEqual(['gstin']);
    }
    expect(
      partyCreateSchema.safeParse({ ...regular, gstRegistrationType: 'consumer', gstin: null })
        .success,
    ).toBe(true);
  });

  it('defaults an absent GSTIN to null, so an unregistered party need not send it', () => {
    const { gstin: _omit, ...withoutGstin } = regular;
    expect(
      partyCreateSchema.parse({ ...withoutGstin, gstRegistrationType: 'consumer' }).gstin,
    ).toBeNull();
    expect(pathsOf(partyCreateSchema.safeParse(withoutGstin))).toEqual(['gstin']);
  });

  it('requires the GSTIN state to equal the default billing address state', () => {
    const karnatakaBilling = { ...billing, stateCode: '29', pincode: '560001', city: 'Bengaluru' };
    expect(
      pathsOf(partyCreateSchema.safeParse({ ...regular, addresses: [karnatakaBilling] })),
    ).toEqual(['gstin']);
  });

  it('requires the PAN to match the GSTIN', () => {
    expect(pathsOf(partyCreateSchema.safeParse({ ...regular, pan: 'AAGCB7383J' }))).toEqual([
      'pan',
    ]);
    expect(partyCreateSchema.safeParse({ ...regular, pan: 'aapfu0939f' }).success).toBe(true);
  });

  it('requires exactly one default billing address and at most one default shipping address', () => {
    expect(pathsOf(partyCreateSchema.safeParse({ ...regular, addresses: [] }))).toEqual([
      'addresses',
    ]);
    expect(
      pathsOf(
        partyCreateSchema.safeParse({ ...regular, addresses: [{ ...billing, isDefault: false }] }),
      ),
    ).toEqual(['addresses']);
    expect(
      pathsOf(partyCreateSchema.safeParse({ ...regular, addresses: [billing, billing] })),
    ).toEqual(['addresses']);
    const shipping = { ...billing, kind: 'shipping' };
    expect(
      pathsOf(
        partyCreateSchema.safeParse({ ...regular, addresses: [billing, shipping, shipping] }),
      ),
    ).toEqual(['addresses']);
    expect(
      partyCreateSchema.safeParse({ ...regular, addresses: [billing, shipping] }).success,
    ).toBe(true);
  });

  it('takes an Indian address with state and 6-digit pincode, a foreign one without state', () => {
    expect(
      pathsOf(
        partyCreateSchema.safeParse({ ...regular, addresses: [{ ...billing, stateCode: null }] }),
      ),
    ).toEqual(['addresses.0.stateCode']);
    expect(
      pathsOf(
        partyCreateSchema.safeParse({ ...regular, addresses: [{ ...billing, pincode: '4110' }] }),
      ),
    ).toEqual(['addresses.0.pincode']);
    const overseas = {
      ...regular,
      gstRegistrationType: 'overseas',
      gstin: null,
      addresses: [
        { kind: 'billing', line1: '1 Main St', city: 'Dubai', country: 'AE', isDefault: true },
      ],
    };
    expect(partyCreateSchema.safeParse(overseas).success).toBe(true);
    expect(
      pathsOf(
        partyCreateSchema.safeParse({
          ...overseas,
          addresses: [{ ...overseas.addresses[0], stateCode: '27' }],
        }),
      ),
    ).toEqual(['addresses.0.stateCode']);
  });

  it('rejects the legacy state codes on addresses', () => {
    const unregistered = { ...regular, gstRegistrationType: 'unregistered', gstin: null };
    for (const stateCode of ['25', '28']) {
      expect(
        pathsOf(
          partyCreateSchema.safeParse({ ...unregistered, addresses: [{ ...billing, stateCode }] }),
        ),
        stateCode,
      ).toEqual(['addresses.0.stateCode']);
    }
  });

  it('keeps the credit limit as non-negative paise (null = no limit, 0 = cash only)', () => {
    expect(partyCreateSchema.parse({ ...regular, creditLimit: '0' }).creditLimit).toBe('0');
    expect(partyCreateSchema.parse({ ...regular, creditLimit: '50000000' }).creditLimit).toBe(
      '50000000',
    );
    expect(pathsOf(partyCreateSchema.safeParse({ ...regular, creditLimit: '-1' }))).toEqual([
      'creditLimit',
    ]);
    expect(pathsOf(partyCreateSchema.safeParse({ ...regular, creditLimit: 500 }))).toEqual([
      'creditLimit',
    ]);
  });

  it('is strict, on the party and on each address', () => {
    expect(
      unrecognizedKeysOf(partyCreateSchema.safeParse({ ...regular, creditLimitPaise: '0' })),
    ).toEqual(['creditLimitPaise']);
    expect(
      unrecognizedKeysOf(
        partyCreateSchema.safeParse({ ...regular, addresses: [{ ...billing, gstin: 'x' }] }),
      ),
    ).toEqual(['gstin']);
  });
});

describe('partyUpdateSchema and partyRecordSchema', () => {
  it('updates partially with a version and no create defaults', () => {
    expect(partyUpdateSchema.parse({ creditDays: 30, version: 2 })).toEqual({
      creditDays: 30,
      version: 2,
    });
    expect(pathsOf(partyUpdateSchema.safeParse({ version: 2 }))).toEqual(['']);
    expect(unrecognizedKeysOf(partyUpdateSchema.safeParse({ id: meta.id, version: 2 }))).toEqual([
      'id',
    ]);
  });

  it('accepts the stored party as a record, addresses with their ids', () => {
    expect(partyRecordSchema.parse(existing).addresses[0]?.id).toBe(existing.addresses[0]?.id);
  });

  it('rejects a patch that is valid alone but leaves a GSTIN on a consumer once merged', () => {
    const patch = { gstRegistrationType: 'consumer', version: 2 };
    expect(partyUpdateSchema.safeParse(patch).success).toBe(true);
    expect(pathsOf(partyRecordSchema.safeParse({ ...existing, ...patch }))).toEqual(['gstin']);
  });

  it('rejects replaced addresses whose billing state no longer matches the GSTIN', () => {
    const patch = {
      addresses: [{ ...billing, stateCode: '29', city: 'Bengaluru', pincode: '560001' }],
      version: 2,
    };
    expect(partyUpdateSchema.safeParse(patch).success).toBe(true);
    expect(pathsOf(partyRecordSchema.safeParse({ ...existing, ...patch }))).toEqual(['gstin']);
  });

  it('filters by type and active, and sorts on allowed columns', () => {
    expect(
      partyListQuerySchema.parse({ type: 'vendor', active: 'true', q: 'steel', sort: 'name:asc' }),
    ).toMatchObject({ type: 'vendor', active: true, q: 'steel', sort: 'name:asc' });
    expect(pathsOf(partyListQuerySchema.safeParse({ sort: 'creditLimit:desc' }))).toEqual(['sort']);
  });
});

describe('partyResponseSchema', () => {
  it('parses a DB-shaped party row', () => {
    const row = {
      ...existing,
      name: 'UMIYA STEEL ', // as imported from Tally, untrimmed
      phone: '020 2456 7890', // stored before the E.164 rule
      email: 'Accounts@Umiya.in',
      creditLimit: null,
      addresses: [
        ...existing.addresses,
        {
          id: uuidv7(),
          kind: 'shipping',
          label: null,
          line1: '1 Main St',
          line2: null,
          city: 'Dubai',
          stateCode: null,
          pincode: 'DXB 1',
          country: 'AE',
          isDefault: false,
        },
      ],
    };
    expect(partyResponseSchema.parse(row)).toEqual(row);
  });
});
