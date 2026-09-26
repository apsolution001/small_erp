import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import {
  acceptInvitationSchema,
  loginResponseSchema,
  loginSchema,
  passwordSchema,
  selectTenantSchema,
  signupSchema,
  switchTenantSchema,
} from './auth.js';

const signup = {
  fullName: ' Ayush Raiyani ',
  email: 'Owner@Example.com',
  mobile: '+919876543210',
  password: 'correct horse battery',
  gstin: '27aapfu0939f1zv',
  acceptTerms: true,
};

describe('signupSchema', () => {
  it('normalises name, email and GSTIN', () => {
    expect(signupSchema.parse(signup)).toEqual({
      ...signup,
      fullName: 'Ayush Raiyani',
      email: 'owner@example.com',
      gstin: '27AAPFU0939F1ZV',
    });
  });

  it('requires accepting the terms and a valid GSTIN', () => {
    expect(pathsOf(signupSchema.safeParse({ ...signup, acceptTerms: false }))).toEqual([
      'acceptTerms',
    ]);
    expect(pathsOf(signupSchema.safeParse({ ...signup, gstin: '27AAPFU0939F1ZA' }))).toEqual([
      'gstin',
    ]);
  });

  it('rejects a GSTIN with a legacy state code', () => {
    // 28 (old Andhra Pradesh) with a valid checksum.
    expect(pathsOf(signupSchema.safeParse({ ...signup, gstin: '28AAPFU0939F1ZT' }))).toEqual([
      'gstin',
    ]);
  });
});

describe('passwordSchema', () => {
  it('needs at least 10 characters', () => {
    expect(passwordSchema.safeParse('123456789').success).toBe(false);
    expect(passwordSchema.safeParse('1234567890').success).toBe(true);
  });

  it('rejects passwords bcrypt would silently truncate (over 72 UTF-8 bytes)', () => {
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse('₹'.repeat(25)).success).toBe(false); // 75 bytes, 25 chars
  });
});

describe('login and tenant selection', () => {
  it('login does not apply the password policy (old passwords must still work)', () => {
    expect(loginSchema.parse({ email: 'A@b.in', password: 'short' })).toEqual({
      email: 'a@b.in',
      password: 'short',
    });
    expect(pathsOf(loginSchema.safeParse({ email: 'a@b.in', password: '' }))).toEqual(['password']);
  });

  it('login refuses a password over 72 UTF-8 bytes (bcrypt would ignore the rest)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.in', password: 'a'.repeat(72) }).success).toBe(true);
    expect(pathsOf(loginSchema.safeParse({ email: 'a@b.in', password: 'a'.repeat(73) }))).toEqual([
      'password',
    ]);
    expect(pathsOf(loginSchema.safeParse({ email: 'a@b.in', password: '₹'.repeat(25) }))).toEqual([
      'password',
    ]);
  });

  it('parses both login outcomes', () => {
    const tenantId = uuidv7();
    const selection = {
      requiresTenantSelection: true,
      selectionToken: 'signed.token',
      tenants: [{ tenantId, name: 'Acme Traders', slug: 'acme-traders', roleName: 'Owner' }],
    };
    expect(loginResponseSchema.parse(selection)).toEqual(selection);

    const session = {
      accessToken: 'jwt',
      user: { id: uuidv7(), email: 'a@b.in', fullName: 'A', mobile: '+919876543210' },
      tenant: {
        id: tenantId,
        slug: 'acme-traders',
        name: 'Acme Traders',
        status: 'trial',
        plan: 'growth',
        trialEndsAt: '2026-10-10T00:00:00.000Z',
      },
      membership: {
        id: uuidv7(),
        role: { id: uuidv7(), name: 'Owner' },
        allBranches: true,
        branchIds: [],
        status: 'active',
      },
    };
    expect(loginResponseSchema.parse(session)).toEqual(session);
  });

  it('selects and switches tenants by id', () => {
    const tenantId = uuidv7();
    expect(selectTenantSchema.parse({ selectionToken: 't', tenantId })).toEqual({
      selectionToken: 't',
      tenantId,
    });
    expect(pathsOf(switchTenantSchema.safeParse({ tenantId: 'x' }))).toEqual(['tenantId']);
  });
});

describe('acceptInvitationSchema', () => {
  it('lets an existing user accept with just the token', () => {
    expect(acceptInvitationSchema.parse({ token: 'tok' })).toEqual({ token: 'tok' });
  });

  it('requires name and password together for a new user', () => {
    expect(
      acceptInvitationSchema.safeParse({
        token: 'tok',
        fullName: 'New User',
        password: '1234567890',
      }).success,
    ).toBe(true);
    expect(
      pathsOf(acceptInvitationSchema.safeParse({ token: 'tok', fullName: 'New User' })),
    ).toEqual(['password']);
    expect(
      pathsOf(acceptInvitationSchema.safeParse({ token: 'tok', password: '1234567890' })),
    ).toEqual(['password']);
  });
});

describe('request bodies are strict', () => {
  const tenantId = uuidv7();
  it.each([
    ['signup', signupSchema, { ...signup, plan: 'pro' }, 'plan'],
    ['login', loginSchema, { email: 'a@b.in', password: 'x', remember: true }, 'remember'],
    ['select-tenant', selectTenantSchema, { selectionToken: 't', tenantId, role: 'x' }, 'role'],
    ['switch-tenant', switchTenantSchema, { tenantId, userId: tenantId }, 'userId'],
    ['accept-invitation', acceptInvitationSchema, { token: 't', email: 'a@b.in' }, 'email'],
  ] as const)('%s rejects an unknown key', (_name, schema, body, key) => {
    expect(unrecognizedKeysOf(schema.safeParse(body))).toEqual([key]);
  });
});
