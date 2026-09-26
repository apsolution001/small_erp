import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { type DomainError } from '../../../common/errors/domain-error.js';
import { type AccessSnapshot } from '../../access/index.js';
import { assertUsableSession } from './session-rules.js';

const snapshot: AccessSnapshot = {
  membershipId: uuidv7(),
  tenantId: uuidv7(),
  userId: uuidv7(),
  membershipStatus: 'active',
  userStatus: 'active',
  tenantStatus: 'trial',
  role: { id: uuidv7(), name: 'Sales', isOwner: false },
  permissions: ['masters.item:view'],
  allBranches: true,
  branchIds: [],
};
const expected = { userId: snapshot.userId, tenantId: snapshot.tenantId };

function failure(access: AccessSnapshot | undefined, who = expected): [number, string] {
  try {
    assertUsableSession(access, who);
  } catch (error) {
    const domain = error as DomainError;
    return [domain.status, domain.code];
  }
  throw new Error('expected a failure');
}

describe('assertUsableSession', () => {
  it('returns an active session of the expected user and tenant', () => {
    expect(assertUsableSession(snapshot, expected)).toBe(snapshot);
    expect(assertUsableSession({ ...snapshot, tenantStatus: 'active' }, expected)).toBeDefined();
    expect(assertUsableSession(snapshot, { userId: snapshot.userId })).toBe(snapshot);
  });

  it('rejects a missing membership or one of another user or tenant (401 TOKEN_INVALID)', () => {
    expect(failure(undefined)).toEqual([401, 'TOKEN_INVALID']);
    expect(failure({ ...snapshot, userId: uuidv7() })).toEqual([401, 'TOKEN_INVALID']);
    expect(failure({ ...snapshot, tenantId: uuidv7() })).toEqual([401, 'TOKEN_INVALID']);
  });

  it('rejects a disabled user (401), a closed tenant (403) and a disabled membership (403)', () => {
    expect(failure({ ...snapshot, userStatus: 'disabled' })).toEqual([401, 'ACCOUNT_DISABLED']);
    expect(failure({ ...snapshot, tenantStatus: 'suspended' })).toEqual([403, 'TENANT_SUSPENDED']);
    expect(failure({ ...snapshot, tenantStatus: 'closed' })).toEqual([403, 'TENANT_SUSPENDED']);
    expect(failure({ ...snapshot, membershipStatus: 'disabled' })).toEqual([403, 'FORBIDDEN']);
    expect(failure({ ...snapshot, membershipStatus: 'invited' })).toEqual([403, 'FORBIDDEN']);
  });
});
