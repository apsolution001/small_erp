import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import {
  roleCloneSchema,
  roleCreateSchema,
  roleListQuerySchema,
  roleResponseSchema,
  roleUpdateSchema,
} from './roles.js';
import {
  invitationResponseSchema,
  userInviteSchema,
  userListQuerySchema,
  userRecordSchema,
  userResponseSchema,
  userUpdateSchema,
} from './users.js';

const roleId = uuidv7();
const branchId = uuidv7();
const meta = {
  id: uuidv7(),
  version: 3,
  createdAt: '2026-09-01T04:30:00.000Z',
  updatedAt: '2026-09-02T04:30:00.000Z',
};

describe('userInviteSchema', () => {
  it('defaults to all branches and normalises the email', () => {
    expect(userInviteSchema.parse({ email: ' Clerk@Example.com', roleId })).toEqual({
      email: 'clerk@example.com',
      roleId,
      allBranches: true,
      branchIds: [],
    });
  });

  it('requires branches when not all branches, and none when all branches', () => {
    expect(
      pathsOf(userInviteSchema.safeParse({ email: 'a@b.in', roleId, allBranches: false })),
    ).toEqual(['branchIds']);
    expect(
      userInviteSchema.safeParse({
        email: 'a@b.in',
        roleId,
        allBranches: false,
        branchIds: [branchId],
      }).success,
    ).toBe(true);
    expect(
      pathsOf(
        userInviteSchema.safeParse({
          email: 'a@b.in',
          roleId,
          allBranches: true,
          branchIds: [branchId],
        }),
      ),
    ).toEqual(['branchIds']);
  });

  it('rejects duplicate branch ids', () => {
    expect(
      pathsOf(
        userInviteSchema.safeParse({
          email: 'a@b.in',
          roleId,
          allBranches: false,
          branchIds: [branchId, branchId],
        }),
      ),
    ).toEqual(['branchIds']);
  });

  it('is strict', () => {
    expect(
      unrecognizedKeysOf(userInviteSchema.safeParse({ email: 'a@b.in', roleId, tenantId: roleId })),
    ).toEqual(['tenantId']);
  });
});

describe('userUpdateSchema', () => {
  it('requires a version and accepts a partial change without create defaults', () => {
    expect(userUpdateSchema.parse({ status: 'disabled', version: 3 })).toEqual({
      status: 'disabled',
      version: 3,
    });
    expect(pathsOf(userUpdateSchema.safeParse({ status: 'disabled' }))).toEqual(['version']);
    expect(userUpdateSchema.parse({ roleId, version: 3 })).toEqual({ roleId, version: 3 });
  });

  it('rejects an update with nothing but the version', () => {
    expect(pathsOf(userUpdateSchema.safeParse({ version: 3 }))).toEqual(['']);
  });

  it('cannot set a membership back to invited', () => {
    expect(pathsOf(userUpdateSchema.safeParse({ status: 'invited', version: 1 }))).toEqual([
      'status',
    ]);
  });

  it('rejects unknown and immutable keys', () => {
    expect(
      unrecognizedKeysOf(userUpdateSchema.safeParse({ userId: roleId, roleId, version: 1 })),
    ).toEqual(['userId']);
  });
});

describe('userRecordSchema (merged PATCH)', () => {
  const existing = {
    ...meta,
    userId: uuidv7(),
    email: 'clerk@example.com',
    fullName: 'Clerk',
    mobile: null,
    role: { id: roleId, name: 'Sales' },
    roleId,
    allBranches: true,
    branchIds: [],
    status: 'invited' as const,
    joinedAt: null,
  };

  it('accepts a valid merged record, including an invited membership', () => {
    expect(userRecordSchema.parse({ ...existing, roleId: branchId })).toEqual({
      roleId: branchId,
      allBranches: true,
      branchIds: [],
      status: 'invited',
    });
  });

  it('rejects a patch that is valid alone but breaks the branch scope once merged', () => {
    const patch = { allBranches: false, version: 3 };
    expect(userUpdateSchema.safeParse(patch).success).toBe(true);
    expect(pathsOf(userRecordSchema.safeParse({ ...existing, ...patch }))).toEqual(['branchIds']);
  });
});

describe('userListQuerySchema', () => {
  it('adds status, role and sort filters to pagination', () => {
    expect(userListQuerySchema.parse({ status: 'active', roleId, sort: 'email:asc' })).toEqual({
      page: 1,
      pageSize: 25,
      status: 'active',
      roleId,
      sort: 'email:asc',
    });
    expect(pathsOf(userListQuerySchema.safeParse({ sort: 'passwordHash:asc' }))).toEqual(['sort']);
    expect(unrecognizedKeysOf(userListQuerySchema.safeParse({ tenantId: roleId }))).toEqual([
      'tenantId',
    ]);
  });
});

describe('user responses', () => {
  it('parse a DB-shaped membership joined with its user', () => {
    const row = {
      ...meta,
      userId: uuidv7(),
      email: 'old.user@example.com',
      fullName: 'Old User ',
      mobile: '9876543210', // stored before the E.164 rule
      role: { id: roleId, name: 'Owner' },
      allBranches: false,
      branchIds: [branchId],
      status: 'active',
      joinedAt: '2026-04-01T10:00:00+05:30',
    };
    expect(userResponseSchema.parse(row)).toEqual(row);
  });

  it('parse a DB-shaped invitation', () => {
    const row = {
      id: uuidv7(),
      email: 'new@example.com',
      role: { id: roleId, name: 'Viewer' },
      allBranches: true,
      branchIds: [],
      expiresAt: '2026-10-03T00:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-09-26T00:00:00.000Z',
    };
    expect(invitationResponseSchema.parse(row)).toEqual(row);
  });
});

describe('role schemas', () => {
  it('creates a role with validated, unique permissions', () => {
    expect(
      roleCreateSchema.parse({ name: ' Dispatch ', permissions: ['masters.item:view'] }),
    ).toEqual({
      name: 'Dispatch',
      description: null,
      permissions: ['masters.item:view'],
      isBillable: true,
    });
    expect(
      pathsOf(roleCreateSchema.safeParse({ name: 'X', permissions: ['masters.item:fly'] })),
    ).toEqual(['permissions.0']);
    expect(
      pathsOf(
        roleCreateSchema.safeParse({
          name: 'X',
          permissions: ['masters.item:view', 'masters.item:view'],
        }),
      ),
    ).toEqual(['permissions']);
    expect(unrecognizedKeysOf(roleCreateSchema.safeParse({ name: 'X', isSystem: true }))).toEqual([
      'isSystem',
    ]);
  });

  it('updates partially with a version and never applies create defaults', () => {
    expect(roleUpdateSchema.parse({ name: 'Dispatch 2', version: 2 })).toEqual({
      name: 'Dispatch 2',
      version: 2,
    });
    expect(pathsOf(roleUpdateSchema.safeParse({ version: 2 }))).toEqual(['']);
    expect(unrecognizedKeysOf(roleUpdateSchema.safeParse({ isSystem: false, version: 2 }))).toEqual(
      ['isSystem'],
    );
  });

  it('clones under a new name', () => {
    expect(roleCloneSchema.parse({ name: 'Sales (North)' })).toEqual({ name: 'Sales (North)' });
    expect(pathsOf(roleCloneSchema.safeParse({ name: '' }))).toEqual(['name']);
  });

  it('sorts lists by name or creation only', () => {
    expect(roleListQuerySchema.parse({ sort: 'name:asc' }).sort).toBe('name:asc');
    expect(pathsOf(roleListQuerySchema.safeParse({ sort: 'permissions:asc' }))).toEqual(['sort']);
  });

  it('parses a DB-shaped role', () => {
    const row = {
      ...meta,
      name: 'Accountant',
      description: null,
      permissions: ['masters.item:view', 'audit.log:view'],
      isSystem: true,
      isBillable: true,
    };
    expect(roleResponseSchema.parse(row)).toEqual(row);
  });
});
