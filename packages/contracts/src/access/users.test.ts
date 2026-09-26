import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { roleCloneSchema, roleCreateSchema, roleUpdateSchema } from './roles.js';
import { inviteUserSchema, membershipUpdateSchema, userListQuerySchema } from './users.js';

const roleId = uuidv7();
const branchId = uuidv7();

describe('inviteUserSchema', () => {
  it('defaults to all branches and normalises the email', () => {
    expect(inviteUserSchema.parse({ email: ' Clerk@Example.com', roleId })).toEqual({
      email: 'clerk@example.com',
      roleId,
      allBranches: true,
      branchIds: [],
    });
  });

  it('requires branches when not all branches, and none when all branches', () => {
    const restricted = inviteUserSchema.safeParse({ email: 'a@b.in', roleId, allBranches: false });
    expect(restricted.error?.issues[0]?.path).toEqual(['branchIds']);
    expect(
      inviteUserSchema.safeParse({
        email: 'a@b.in',
        roleId,
        allBranches: false,
        branchIds: [branchId],
      }).success,
    ).toBe(true);
    expect(
      inviteUserSchema.safeParse({
        email: 'a@b.in',
        roleId,
        allBranches: true,
        branchIds: [branchId],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate branch ids', () => {
    expect(
      inviteUserSchema.safeParse({
        email: 'a@b.in',
        roleId,
        allBranches: false,
        branchIds: [branchId, branchId],
      }).success,
    ).toBe(false);
  });
});

describe('membershipUpdateSchema', () => {
  it('requires a version and accepts a partial change', () => {
    expect(membershipUpdateSchema.parse({ status: 'disabled', version: 3 })).toEqual({
      status: 'disabled',
      version: 3,
    });
    expect(membershipUpdateSchema.safeParse({ status: 'disabled' }).success).toBe(false);
  });

  it('cannot set a membership back to invited', () => {
    expect(membershipUpdateSchema.safeParse({ status: 'invited', version: 1 }).success).toBe(false);
  });

  it('applies the branch-scope rule when both fields are sent', () => {
    expect(
      membershipUpdateSchema.safeParse({ allBranches: false, branchIds: [], version: 1 }).success,
    ).toBe(false);
    expect(membershipUpdateSchema.safeParse({ branchIds: [branchId], version: 1 }).success).toBe(
      true,
    );
  });
});

describe('userListQuerySchema', () => {
  it('adds status and role filters to pagination', () => {
    expect(userListQuerySchema.parse({ status: 'active', roleId })).toEqual({
      page: 1,
      pageSize: 25,
      status: 'active',
      roleId,
    });
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
      roleCreateSchema.safeParse({ name: 'X', permissions: ['masters.item:fly'] }).success,
    ).toBe(false);
    expect(
      roleCreateSchema.safeParse({
        name: 'X',
        permissions: ['masters.item:view', 'masters.item:view'],
      }).success,
    ).toBe(false);
  });

  it('updates partially with a version and never applies create defaults', () => {
    expect(roleUpdateSchema.parse({ name: 'Dispatch 2', version: 2 })).toEqual({
      name: 'Dispatch 2',
      version: 2,
    });
  });

  it('clones under a new name', () => {
    expect(roleCloneSchema.parse({ name: 'Sales (North)' })).toEqual({ name: 'Sales (North)' });
    expect(roleCloneSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
