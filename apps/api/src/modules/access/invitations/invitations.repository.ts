import { type InvitationListQuery, type InvitationStatus } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, isNotNull, isNull, lte, gt, type SQL, sql } from 'drizzle-orm';
import { type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { tenantUsers } from '../../auth/users/tenant-users.view.js';
import { findCompanyNames } from '../../masters/index.js';
import { roles } from '../roles/roles.schema.js';
import { invitations, type NewInvitationRow } from './invitations.schema.js';

export interface InvitationListRow {
  readonly id: string;
  readonly email: string;
  readonly roleId: string | null;
  readonly roleName: string | null;
  readonly allBranches: boolean;
  readonly branchIds: string[];
  readonly status: InvitationStatus;
  readonly invitedById: string | null;
  readonly invitedByName: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Where an invitation stands, from the database clock (the same `now()` the filters use).
 * Pending past its expiry reads as `expired`.
 */
const statusSql = sql<InvitationStatus>`case
  when ${invitations.acceptedAt} is not null then 'accepted'
  when ${invitations.revokedAt} is not null then 'revoked'
  when ${invitations.expiresAt} <= now() then 'expired'
  else 'pending' end`;

const open = () => and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

const STATUS_FILTERS: Readonly<Record<InvitationStatus, () => SQL | undefined>> = {
  pending: () => and(open(), gt(invitations.expiresAt, sql`now()`)),
  expired: () => and(open(), lte(invitations.expiresAt, sql`now()`)),
  accepted: () => isNotNull(invitations.acceptedAt),
  revoked: () => isNotNull(invitations.revokedAt),
};

/** The `invitations` table, in the tenant transaction. */
@Injectable()
export class InvitationsRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db() {
    return this.txHost.tx;
  }

  private selectInvitations() {
    return (
      this.db
        .select({
          id: invitations.id,
          email: invitations.email,
          roleId: invitations.roleId,
          roleName: roles.name,
          allBranches: invitations.allBranches,
          branchIds: invitations.branchIds,
          status: statusSql,
          invitedById: invitations.createdBy,
          invitedByName: tenantUsers.fullName,
          expiresAt: invitations.expiresAt,
          acceptedAt: invitations.acceptedAt,
          revokedAt: invitations.revokedAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .leftJoin(
          roles,
          and(eq(roles.tenantId, invitations.tenantId), eq(roles.id, invitations.roleId)),
        )
        // The inviter, through the tenant user directory.
        .leftJoin(tenantUsers, eq(tenantUsers.id, invitations.createdBy))
    );
  }

  async list(query: InvitationListQuery): Promise<{ rows: InvitationListRow[]; total: number }> {
    const where = and(
      query.status === undefined ? undefined : STATUS_FILTERS[query.status](),
      query.q === undefined ? undefined : ilike(invitations.email, containsPattern(query.q)),
    );
    const [rows, [totals]] = await Promise.all([
      this.selectInvitations()
        .where(where)
        .orderBy(
          ...orderByOf(
            query.sort,
            'createdAt:desc',
            {
              email: invitations.email,
              createdAt: invitations.createdAt,
              expiresAt: invitations.expiresAt,
            },
            invitations.id,
          ),
        )
        .limit(query.pageSize)
        .offset(pageOffset(query.page, query.pageSize)),
      this.db.select({ total: count() }).from(invitations).where(where),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(id: string): Promise<InvitationListRow | undefined> {
    const [row] = await this.selectInvitations().where(eq(invitations.id, id));
    return row;
  }

  async insert(values: Omit<NewInvitationRow, 'tenantId'>): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(invitations)
      .values(values)
      .returning({ id: invitations.id });
    if (row === undefined) throw new Error('Invitation insert returned no row');
    return row;
  }

  /** Closes the open (pending or expired) invitation of an email, if any. */
  async revokeOpenByEmail(email: string, now: Date): Promise<void> {
    await this.db
      .update(invitations)
      .set({ revokedAt: now, version: sql`${invitations.version} + 1` })
      .where(and(eq(invitations.email, email), open()));
  }

  /** The company's display name, for the invitation email. */
  async companyName(tenantId: string): Promise<string | undefined> {
    return (await findCompanyNames(this.db, [tenantId])).get(tenantId);
  }

  /** Closes one open invitation. False when it is not open (accepted or already revoked). */
  async revoke(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(invitations)
      .set({ revokedAt: now, version: sql`${invitations.version} + 1` })
      .where(and(eq(invitations.id, id), open()))
      .returning({ id: invitations.id });
    return rows.length > 0;
  }
}
