import { uuidv7 } from '@ekaro/core';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { type UserRow, users } from '../../src/modules/auth/users/users.schema.js';
import { testPlatformDb, withTenantConnection } from '../support/db.js';

/** Test users hash with a low cost: bcrypt reads the cost from the hash, so login still works. */
const TEST_BCRYPT_COST = 4;
export const TEST_PASSWORD = 'correct horse battery staple';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${uuidv7()}@example.com`;
}

/** Inserts a user through `ekaro_platform` (as signup or an accepted invitation would). */
export async function createTestUser(
  overrides: { email?: string; password?: string; fullName?: string } = {},
): Promise<UserRow> {
  const [user] = await testPlatformDb()
    .insert(users)
    .values({
      email: overrides.email ?? uniqueEmail(),
      fullName: overrides.fullName ?? 'Test User',
      mobile: '+919876543210',
      passwordHash: await bcrypt.hash(overrides.password ?? TEST_PASSWORD, TEST_BCRYPT_COST),
    })
    .returning();
  if (user === undefined) throw new Error('user insert returned no row');
  return user;
}

export async function setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<void> {
  await testPlatformDb().update(users).set({ status }).where(eq(users.id, userId));
}

export interface MembershipOptions {
  readonly status?: 'invited' | 'active' | 'disabled';
  /** Restricts the membership to these branches (all branches when omitted). */
  readonly branchIds?: readonly string[];
}

/**
 * Gives a user a membership with the named role in a tenant, through a raw `ekaro_app`
 * connection in that tenant's context (as the T-105 invitation flow will). Returns its id.
 */
export async function addMembership(
  tenantId: string,
  userId: string,
  roleName: string,
  options: MembershipOptions = {},
): Promise<string> {
  const status = options.status ?? 'active';
  const branchIds = options.branchIds ?? [];
  return withTenantConnection(tenantId, async (c) => {
    const role = await c.query<{ id: string }>('select id from roles where name = $1', [roleName]);
    const roleId = role.rows[0]?.id;
    if (roleId === undefined) throw new Error(`No role "${roleName}" in tenant ${tenantId}`);
    const membershipId = uuidv7();
    await c.query(
      `insert into memberships (id, user_id, role_id, all_branches, status, joined_at)
       values ($1, $2, $3, $4, $5, case when $5 = 'active' then now() end)`,
      [membershipId, userId, roleId, branchIds.length === 0, status],
    );
    for (const branchId of branchIds) {
      await c.query('insert into membership_branches (membership_id, branch_id) values ($1, $2)', [
        membershipId,
        branchId,
      ]);
    }
    return membershipId;
  });
}
