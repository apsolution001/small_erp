import { describe, expect, it } from 'vitest';
import { partyCreateSchema, partyListQuerySchema, partyUpdateSchema } from './party.js';

const pathsOf = (result: { error?: { issues: { path: PropertyKey[] }[] } | undefined }): string[] =>
  (result.error?.issues ?? []).map((i) => i.path.join('.'));

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

describe('partyCreateSchema', () => {
  it('applies defaults to the party and its addresses', () => {
    expect(partyCreateSchema.parse(regular)).toEqual({
      ...regular,
      pan: null,
      creditLimitPaise: null,
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

  it('keeps the credit limit as non-negative paise (null = no limit, 0 = cash only)', () => {
    expect(partyCreateSchema.parse({ ...regular, creditLimitPaise: '0' }).creditLimitPaise).toBe(
      '0',
    );
    expect(
      partyCreateSchema.parse({ ...regular, creditLimitPaise: '50000000' }).creditLimitPaise,
    ).toBe('50000000');
    expect(pathsOf(partyCreateSchema.safeParse({ ...regular, creditLimitPaise: '-1' }))).toEqual([
      'creditLimitPaise',
    ]);
    expect(partyCreateSchema.safeParse({ ...regular, creditLimitPaise: 500 }).success).toBe(false);
  });
});

describe('partyUpdateSchema and list query', () => {
  it('updates partially with a version', () => {
    expect(partyUpdateSchema.parse({ creditDays: 30, version: 2 })).toEqual({
      creditDays: 30,
      version: 2,
    });
  });

  it('re-checks addresses when they are replaced', () => {
    expect(
      pathsOf(
        partyUpdateSchema.safeParse({ addresses: [{ ...billing, isDefault: false }], version: 2 }),
      ),
    ).toEqual(['addresses']);
  });

  it('filters by type and active', () => {
    expect(
      partyListQuerySchema.parse({ type: 'vendor', active: 'true', q: 'steel' }),
    ).toMatchObject({
      type: 'vendor',
      active: true,
      q: 'steel',
    });
  });
});
