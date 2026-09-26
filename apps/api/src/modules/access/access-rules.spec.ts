import { PERMISSIONS, type Permission, defaultRole } from '@ekaro/contracts';
import { describe, expect, it } from 'vitest';
import {
  type Actor,
  assertMembershipChange,
  assertRoleDeletable,
  assertRoleEdit,
  assertWithinAuthority,
  type MembershipState,
  type RoleGrant,
} from './access-rules.js';

const ALL: readonly Permission[] = PERMISSIONS;
const ADMIN = defaultRole('Admin').permissions;
const SALES = defaultRole('Sales').permissions;

const owner: Actor = { membershipId: 'm-owner', isOwner: true, permissions: new Set(ALL) };
const admin: Actor = { membershipId: 'm-admin', isOwner: false, permissions: new Set(ADMIN) };

const ownerRole: RoleGrant & { id: string } = { id: 'r-owner', isOwner: true, permissions: ALL };
const adminRole: RoleGrant & { id: string } = { id: 'r-admin', isOwner: false, permissions: ADMIN };
const salesRole: RoleGrant & { id: string } = { id: 'r-sales', isOwner: false, permissions: SALES };

const codeOf = (fn: () => void): { status: number; code: string } | undefined => {
  try {
    fn();
    return undefined;
  } catch (error) {
    const { status, code } = error as { status: number; code: string };
    return { status, code };
  }
};

describe('assertWithinAuthority (nobody grants more than they hold)', () => {
  it('lets the Owner grant anything, the Owner role included', () => {
    expect(
      codeOf(() => {
        assertWithinAuthority(owner, ownerRole);
      }),
    ).toBeUndefined();
    expect(
      codeOf(() => {
        assertWithinAuthority(owner, adminRole);
      }),
    ).toBeUndefined();
  });

  it('only an Owner assigns the Owner role (403 OWNER_ASSIGNMENT_FORBIDDEN)', () => {
    expect(
      codeOf(() => {
        assertWithinAuthority(admin, ownerRole);
      }),
    ).toEqual({
      status: 403,
      code: 'OWNER_ASSIGNMENT_FORBIDDEN',
    });
  });

  it('refuses a role with a permission the actor lacks (403 PERMISSION_NOT_HELD)', () => {
    const billing: RoleGrant = { isOwner: false, permissions: ['platform.billing:view'] };
    expect(
      codeOf(() => {
        assertWithinAuthority(admin, billing);
      }),
    ).toEqual({
      status: 403,
      code: 'PERMISSION_NOT_HELD',
    });
    expect(() => {
      assertWithinAuthority(admin, billing);
    }).toThrow('You cannot grant permissions you do not hold: platform.billing:view.');
    expect(
      codeOf(() => {
        assertWithinAuthority(admin, salesRole);
      }),
    ).toBeUndefined();
  });
});

describe('assertMembershipChange (spec 01 §3.3)', () => {
  const active = (membershipId: string, role: RoleGrant & { id: string }): MembershipState => ({
    membershipId,
    role,
    status: 'active',
  });

  it('you cannot change your own role (422 SELF_ROLE_CHANGE)', () => {
    const self = active('m-admin', adminRole);
    expect(
      codeOf(() => {
        assertMembershipChange(admin, self, { role: salesRole, status: 'active' }, 1);
      }),
    ).toEqual({ status: 422, code: 'SELF_ROLE_CHANGE' });
    const ownSelf = active('m-owner', ownerRole);
    expect(
      codeOf(() => {
        assertMembershipChange(owner, ownSelf, { role: adminRole, status: 'active' }, 3);
      }),
    ).toEqual({ status: 422, code: 'SELF_ROLE_CHANGE' });
  });

  it('you cannot disable yourself (422 SELF_DISABLE)', () => {
    const self = active('m-admin', adminRole);
    expect(
      codeOf(() => {
        assertMembershipChange(admin, self, { role: adminRole, status: 'disabled' }, 1);
      }),
    ).toEqual({ status: 422, code: 'SELF_DISABLE' });
  });

  it('lets you keep your own role and status (a branch-scope change)', () => {
    const self = active('m-admin', adminRole);
    expect(
      codeOf(() => {
        assertMembershipChange(admin, self, { role: adminRole, status: 'active' }, 1);
      }),
    ).toBeUndefined();
  });

  it('only an Owner assigns the Owner role (403 OWNER_ASSIGNMENT_FORBIDDEN)', () => {
    const clerk = active('m-clerk', salesRole);
    expect(
      codeOf(() => {
        assertMembershipChange(admin, clerk, { role: ownerRole, status: 'active' }, 1);
      }),
    ).toEqual({ status: 403, code: 'OWNER_ASSIGNMENT_FORBIDDEN' });
    expect(
      codeOf(() => {
        assertMembershipChange(owner, clerk, { role: ownerRole, status: 'active' }, 1);
      }),
    ).toBeUndefined();
  });

  it("only an Owner changes an Owner's membership (demote or disable)", () => {
    const other = active('m-owner-2', ownerRole);
    expect(
      codeOf(() => {
        assertMembershipChange(admin, other, { role: salesRole, status: 'active' }, 1);
      }),
    ).toEqual({ status: 403, code: 'OWNER_ASSIGNMENT_FORBIDDEN' });
    expect(
      codeOf(() => {
        assertMembershipChange(admin, other, { role: ownerRole, status: 'disabled' }, 1);
      }),
    ).toEqual({ status: 403, code: 'OWNER_ASSIGNMENT_FORBIDDEN' });
  });

  it('refuses to hand out a role beyond your permissions (403 PERMISSION_NOT_HELD)', () => {
    const clerk = active('m-clerk', salesRole);
    const billing = { id: 'r-billing', isOwner: false, permissions: ['platform.billing:edit'] };
    expect(
      codeOf(() => {
        assertMembershipChange(
          admin,
          clerk,
          { role: { ...billing, permissions: ['platform.billing:edit'] }, status: 'active' },
          1,
        );
      }),
    ).toEqual({ status: 403, code: 'PERMISSION_NOT_HELD' });
  });

  it('never disables or demotes the last active Owner (422 LAST_OWNER)', () => {
    const other = active('m-owner-2', ownerRole);
    expect(
      codeOf(() => {
        assertMembershipChange(owner, other, { role: ownerRole, status: 'disabled' }, 0);
      }),
    ).toEqual({ status: 422, code: 'LAST_OWNER' });
    expect(
      codeOf(() => {
        assertMembershipChange(owner, other, { role: adminRole, status: 'active' }, 0);
      }),
    ).toEqual({ status: 422, code: 'LAST_OWNER' });
    // With another active Owner left, it is allowed.
    expect(
      codeOf(() => {
        assertMembershipChange(owner, other, { role: ownerRole, status: 'disabled' }, 1);
      }),
    ).toBeUndefined();
  });

  it('does not count a disabled Owner: re-enabling or changing one needs no other Owner', () => {
    const disabled: MembershipState = { membershipId: 'm-o3', role: ownerRole, status: 'disabled' };
    expect(
      codeOf(() => {
        assertMembershipChange(owner, disabled, { role: adminRole, status: 'disabled' }, 0);
      }),
    ).toBeUndefined();
  });
});

describe('assertRoleEdit', () => {
  const stored = (role: RoleGrant) => ({
    isOwner: role.isOwner,
    permissions: role.permissions,
    isBillable: true,
  });

  it("refuses to edit the Owner role's permissions or billing (422 SYSTEM_ROLE_IMMUTABLE)", () => {
    expect(
      codeOf(() => {
        assertRoleEdit(owner, stored(ownerRole), { permissions: ADMIN, isBillable: true });
      }),
    ).toEqual({ status: 422, code: 'SYSTEM_ROLE_IMMUTABLE' });
    expect(
      codeOf(() => {
        assertRoleEdit(owner, stored(ownerRole), { permissions: ALL, isBillable: false });
      }),
    ).toEqual({ status: 422, code: 'SYSTEM_ROLE_IMMUTABLE' });
  });

  it('lets the Owner rename the Owner role (same permissions, in any order)', () => {
    expect(
      codeOf(() => {
        assertRoleEdit(owner, stored(ownerRole), {
          permissions: [...ALL].reverse(),
          isBillable: true,
        });
      }),
    ).toBeUndefined();
  });

  it('lets no one else touch the Owner role', () => {
    expect(
      codeOf(() => {
        assertRoleEdit(admin, stored(ownerRole), { permissions: ALL, isBillable: true });
      }),
    ).toEqual({ status: 403, code: 'OWNER_ASSIGNMENT_FORBIDDEN' });
  });

  it('refuses edits that add, or touch a role holding, permissions the actor lacks', () => {
    expect(
      codeOf(() => {
        assertRoleEdit(admin, stored(salesRole), {
          permissions: [...SALES, 'platform.billing:view'],
          isBillable: true,
        });
      }),
    ).toEqual({ status: 403, code: 'PERMISSION_NOT_HELD' });
    const billingRole: RoleGrant = { isOwner: false, permissions: ['platform.billing:view'] };
    expect(
      codeOf(() => {
        assertRoleEdit(admin, stored(billingRole), { permissions: [], isBillable: true });
      }),
    ).toEqual({ status: 403, code: 'PERMISSION_NOT_HELD' });
    expect(
      codeOf(() => {
        assertRoleEdit(admin, stored(salesRole), {
          permissions: [...SALES, 'masters.item:edit'],
          isBillable: true,
        });
      }),
    ).toBeUndefined();
  });
});

describe('assertRoleDeletable', () => {
  it('refuses system roles (422 SYSTEM_ROLE_IMMUTABLE)', () => {
    expect(
      codeOf(() => {
        assertRoleDeletable({ isSystem: true }, false);
      }),
    ).toEqual({
      status: 422,
      code: 'SYSTEM_ROLE_IMMUTABLE',
    });
  });

  it('refuses a role in use (409 ROLE_IN_USE)', () => {
    expect(
      codeOf(() => {
        assertRoleDeletable({ isSystem: false }, true);
      }),
    ).toEqual({
      status: 409,
      code: 'ROLE_IN_USE',
    });
    expect(
      codeOf(() => {
        assertRoleDeletable({ isSystem: false }, false);
      }),
    ).toBeUndefined();
  });
});
