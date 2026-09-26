import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import {
  roleCloneSchema,
  roleCreateSchema,
  roleListQuerySchema,
  roleRecordSchema,
  roleResponseSchema,
  roleUpdateSchema,
} from './roles.js';
import {
  invitationListQuerySchema,
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
      status: 'pending',
      invitedBy: { id: uuidv7(), name: 'Asha Mehta' },
      expiresAt: '2026-10-03T00:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-09-26T00:00:00.000Z',
    };
    expect(invitationResponseSchema.parse(row)).toEqual(row);
    const closed = { ...row, role: null, invitedBy: null, status: 'revoked' };
    expect(invitationResponseSchema.parse(closed)).toEqual(closed);
    expect(pathsOf(invitationResponseSchema.safeParse({ ...row, status: 'lost' }))).toEqual([
      'status',
    ]);
  });
});

describe('invitationListQuerySchema', () => {
  it('filters by status and sorts by email, creation or expiry only', () => {
    expect(invitationListQuerySchema.parse({ status: 'expired', sort: 'expiresAt:asc' })).toEqual({
      page: 1,
      pageSize: 25,
      status: 'expired',
      sort: 'expiresAt:asc',
    });
    expect(pathsOf(invitationListQuerySchema.safeParse({ sort: 'tokenHash:asc' }))).toEqual([
      'sort',
    ]);
    expect(pathsOf(invitationListQuerySchema.safeParse({ status: 'lost' }))).toEqual(['status']);
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
      isOwner: false,
      isBillable: true,
    };
    expect(roleResponseSchema.parse(row)).toEqual(row);
  });
});

describe('free (non-billable) roles are read-only (BRD §12)', () => {
  const readOnly = ['masters.item:view', 'masters.party:export', 'audit.log:view'] as const;

  it('lets a free role view and export only', () => {
    expect(
      roleCreateSchema.safeParse({ name: 'Auditor', isBillable: false, permissions: readOnly })
        .success,
    ).toBe(true);
    const res = roleCreateSchema.safeParse({
      name: 'Cheap clerk',
      isBillable: false,
      permissions: [...readOnly, 'masters.item:edit', 'masters.party:create'],
    });
    expect(pathsOf(res)).toEqual(['permissions']);
    expect(res.error?.issues[0]?.message).toBe(
      'A free (non-billable) role can only view and export; remove masters.item:edit, masters.party:create',
    );
  });

  it('lets a billable role hold anything', () => {
    expect(
      roleCreateSchema.safeParse({ name: 'Clerk', permissions: ['masters.item:delete'] }).success,
    ).toBe(true);
  });

  it('checks the merged record, so a patch cannot sneak a write into a free role', () => {
    const existing = {
      name: 'Viewer',
      description: null,
      permissions: ['masters.item:view'],
      isBillable: false,
    };
    const patch = { permissions: ['masters.item:view', 'masters.item:edit'], version: 1 };
    expect(roleUpdateSchema.safeParse(patch).success).toBe(true);
    expect(pathsOf(roleRecordSchema.safeParse({ ...existing, ...patch }))).toEqual(['permissions']);
    expect(roleRecordSchema.parse({ ...existing, isBillable: true, ...patch })).toEqual({
      name: 'Viewer',
      description: null,
      permissions: ['masters.item:view', 'masters.item:edit'],
      isBillable: true,
    });
  });
});
