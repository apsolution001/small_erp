import { type MembershipStatus, type UserListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { tenantUsers } from '../../auth/users/tenant-users.view.js';
import { findActiveBranchIds } from '../../masters/index.js';
import { membershipBranches, memberships } from '../memberships/memberships.schema.js';
import { roles } from '../roles/roles.schema.js';

/** A membership joined with its user and role: one row of the user list. */
export interface MemberRow {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly mobile: string | null;
  readonly roleId: string;
  readonly roleName: string;
  readonly roleIsOwner: boolean;
  readonly rolePermissions: string[];
  readonly allBranches: boolean;
  readonly branchIds: string[];
  readonly status: MembershipStatus;
  readonly joinedAt: Date | null;
}

export interface MembershipChanges {
  readonly roleId: string;
  readonly allBranches: boolean;
  readonly status: MembershipStatus;
  readonly joinedAt: Date | null;
}

/**
 * Memberships with their users (through the auth module's `tenant_users` directory, ADR 0017) and
 * roles, in the tenant transaction.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db() {
    return this.txHost.tx;
  }

  private selectMembers() {
    return this.db
      .select({
        id: memberships.id,
        tenantId: memberships.tenantId,
        version: memberships.version,
        createdAt: memberships.createdAt,
        updatedAt: memberships.updatedAt,
        userId: memberships.userId,
        email: tenantUsers.email,
        fullName: tenantUsers.fullName,
        mobile: tenantUsers.mobile,
        roleId: roles.id,
        roleName: roles.name,
        roleIsOwner: roles.isOwner,
        rolePermissions: roles.permissions,
        allBranches: memberships.allBranches,
        branchIds: sql<string[]>`array(
          select ${membershipBranches.branchId} from ${membershipBranches}
           where ${membershipBranches.membershipId} = ${memberships.id}
           order by ${membershipBranches.branchId})`,
        status: memberships.status,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(tenantUsers, eq(tenantUsers.id, memberships.userId))
      .innerJoin(
        roles,
        and(eq(roles.tenantId, memberships.tenantId), eq(roles.id, memberships.roleId)),
      );
  }

  async list(query: UserListQuery): Promise<{ rows: MemberRow[]; total: number }> {
    const where = and(
      query.status === undefined ? undefined : eq(memberships.status, query.status),
      query.roleId === undefined ? undefined : eq(memberships.roleId, query.roleId),
      query.q === undefined ? undefined : matches(query.q),
    );
    const [rows, [totals]] = await Promise.all([
      this.selectMembers()
        .where(where)
        .orderBy(
          ...orderByOf(
            query.sort,
            'fullName:asc',
            {
              fullName: sql`lower(${tenantUsers.fullName})`,
              email: tenantUsers.email,
              createdAt: memberships.createdAt,
            },
            memberships.id,
          ),
        )
        .limit(query.pageSize)
        .offset(pageOffset(query.page, query.pageSize)),
      this.db
        .select({ total: count() })
        .from(memberships)
        .innerJoin(tenantUsers, eq(tenantUsers.id, memberships.userId))
        .where(where),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(id: string): Promise<MemberRow | undefined> {
    const [row] = await this.selectMembers().where(eq(memberships.id, id));
    return row;
  }

  /** The membership of the user with this email, if they belong to the tenant already. */
  async findIdByEmail(email: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(tenantUsers, eq(tenantUsers.id, memberships.userId))
      .where(eq(tenantUsers.email, email));
    return row?.id;
  }

  /** A tenant user's display name (the inviter on invitation emails). */
  async findUserName(userId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ fullName: tenantUsers.fullName })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, userId));
    return row?.fullName;
  }

  /**
   * Locks the tenant's active Owner memberships and counts those other than `exceptId` whose user
   * is active. Concurrent demotions of two Owners serialise on these locks, so the tenant can
   * never lose its last Owner to a race (the second waits and recounts).
   */
  async countOtherActiveOwners(ownerRoleId: string, exceptId: string): Promise<number> {
    const locked = await this.db
      .select({ id: memberships.id, userStatus: tenantUsers.status })
      .from(memberships)
      .innerJoin(tenantUsers, eq(tenantUsers.id, memberships.userId))
      .where(and(eq(memberships.roleId, ownerRoleId), eq(memberships.status, 'active')))
      .orderBy(memberships.id)
      .for('update', { of: memberships });
    return locked.filter((m) => m.id !== exceptId && m.userStatus === 'active').length;
  }

  /** Optimistic update: undefined when the version no longer matches. */
  async update(
    id: string,
    version: number,
    changes: MembershipChanges,
  ): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .update(memberships)
      .set({ ...changes, version: sql`${memberships.version} + 1` })
      .where(and(eq(memberships.id, id), eq(memberships.version, version)))
      .returning({ id: memberships.id });
    return row;
  }

  /** Replaces the branch scope (empty for all branches). Each change is audited per row. */
  async replaceBranches(membershipId: string, branchIds: readonly string[]): Promise<void> {
    const keep = [...branchIds];
    await this.db
      .delete(membershipBranches)
      .where(
        and(
          eq(membershipBranches.membershipId, membershipId),
          keep.length === 0 ? undefined : notInArray(membershipBranches.branchId, keep),
        ),
      );
    if (keep.length === 0) return;
    await this.db
      .insert(membershipBranches)
      .values(keep.map((branchId) => ({ membershipId, branchId })))
      .onConflictDoNothing();
  }

  /** Which of `ids` are active branches of this tenant. */
  activeBranchIds(ids: readonly string[]): Promise<Set<string>> {
    return findActiveBranchIds(this.db, ids);
  }
}

function matches(q: string): SQL | undefined {
  const pattern = containsPattern(q);
  return or(ilike(tenantUsers.fullName, pattern), ilike(tenantUsers.email, pattern));
}
