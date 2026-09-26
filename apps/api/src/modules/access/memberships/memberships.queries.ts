import { effectivePermissions, type MembershipStatus, type Permission } from '@ekaro/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { roles } from '../roles/roles.schema.js';
import { membershipBranches, memberships } from './memberships.schema.js';

/** What a membership grants: role, effective permissions and branch scope (ADR 0007). */
export interface MembershipAccess {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly status: MembershipStatus;
  readonly role: { readonly id: string; readonly name: string; readonly isOwner: boolean };
  readonly permissions: readonly Permission[];
  readonly allBranches: boolean;
  /** Empty when `allBranches`. */
  readonly branchIds: readonly string[];
}

/**
 * Loads a membership with its role and branches. On the platform connection this reads across
 * tenants (`platform_read`); on the app connection RLS limits it to the tenant in context.
 */
export async function loadMembershipAccess(
  db: DbExecutor,
  membershipId: string,
): Promise<MembershipAccess | undefined> {
  const [row] = await db
    .select({
      membershipId: memberships.id,
      tenantId: memberships.tenantId,
      userId: memberships.userId,
      status: memberships.status,
      allBranches: memberships.allBranches,
      roleId: roles.id,
      roleName: roles.name,
      isOwner: roles.isOwner,
      rolePermissions: roles.permissions,
    })
    .from(memberships)
    .innerJoin(
      roles,
      and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)),
    )
    .where(eq(memberships.id, membershipId));
  if (row === undefined) return undefined;

  const branchRows = row.allBranches
    ? []
    : await db
        .select({ branchId: membershipBranches.branchId })
        .from(membershipBranches)
        .where(
          and(
            eq(membershipBranches.tenantId, row.tenantId),
            eq(membershipBranches.membershipId, row.membershipId),
          ),
        )
        .orderBy(asc(membershipBranches.branchId));

  return {
    membershipId: row.membershipId,
    tenantId: row.tenantId,
    userId: row.userId,
    status: row.status,
    role: { id: row.roleId, name: row.roleName, isOwner: row.isOwner },
    permissions: effectivePermissions({ isOwner: row.isOwner, permissions: row.rolePermissions }),
    allBranches: row.allBranches,
    branchIds: branchRows.map((b) => b.branchId),
  };
}

export interface UserMembership {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly roleName: string;
}

/** A user's active memberships across tenants (login's tenant list), oldest first. */
export async function findActiveMembershipsOfUser(
  db: DbExecutor,
  userId: string,
): Promise<UserMembership[]> {
  return db
    .select({
      membershipId: memberships.id,
      tenantId: memberships.tenantId,
      roleName: roles.name,
    })
    .from(memberships)
    .innerJoin(
      roles,
      and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)),
    )
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
}
