import { type RoleListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, isNull, type SQL, sql } from 'drizzle-orm';
import { type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { invitations } from '../invitations/invitations.schema.js';
import { memberships } from '../memberships/memberships.schema.js';
import { type NewRoleRow, type RoleRow, roles } from './roles.schema.js';

export interface RoleChanges {
  readonly name: string;
  readonly description: string | null;
  readonly permissions: readonly string[];
  readonly isBillable: boolean;
}

/** The `roles` table, in the tenant transaction (RLS scopes every statement). */
@Injectable()
export class RolesRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db() {
    return this.txHost.tx;
  }

  async list(query: RoleListQuery): Promise<{ rows: RoleRow[]; total: number }> {
    const where: SQL | undefined =
      query.q === undefined ? undefined : ilike(roles.name, containsPattern(query.q));
    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(roles)
        .where(where)
        .orderBy(
          ...orderByOf(
            query.sort,
            'name:asc',
            { name: sql`lower(${roles.name})`, createdAt: roles.createdAt },
            roles.id,
          ),
        )
        .limit(query.pageSize)
        .offset(pageOffset(query.page, query.pageSize)),
      this.db.select({ total: count() }).from(roles).where(where),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(id: string): Promise<RoleRow | undefined> {
    const [row] = await this.db.select().from(roles).where(eq(roles.id, id));
    return row;
  }

  /** Locks the role for the rest of the transaction (delete checks its use under this lock). */
  async lockById(id: string): Promise<RoleRow | undefined> {
    const [row] = await this.db.select().from(roles).where(eq(roles.id, id)).for('update');
    return row;
  }

  async findOwnerRole(): Promise<RoleRow | undefined> {
    const [row] = await this.db.select().from(roles).where(eq(roles.isOwner, true));
    return row;
  }

  async insert(values: Omit<NewRoleRow, 'tenantId'>): Promise<RoleRow> {
    const [row] = await this.db.insert(roles).values(values).returning();
    if (row === undefined) throw new Error('Role insert returned no row');
    return row;
  }

  /** Optimistic update: undefined when the version no longer matches (or the role is gone). */
  async update(id: string, version: number, changes: RoleChanges): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .update(roles)
      .set({
        ...changes,
        permissions: [...changes.permissions],
        version: sql`${roles.version} + 1`,
      })
      .where(and(eq(roles.id, id), eq(roles.version, version)))
      .returning();
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(roles).where(eq(roles.id, id));
  }

  /** Held by a membership, or by an invitation that is not closed yet (expired ones included). */
  async isInUse(id: string): Promise<boolean> {
    const [member] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.roleId, id))
      .limit(1);
    if (member !== undefined) return true;
    const [invitation] = await this.db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.roleId, id),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .limit(1);
    return invitation !== undefined;
  }
}
