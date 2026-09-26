import { type BranchListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { lockTenantScope } from '../../../infra/db/tenant-lock.js';
import { godowns } from '../godowns/godowns.schema.js';
import { type BranchRow, branches, type NewBranchRow } from './branches.schema.js';

export type BranchChanges = RowChanges<
  NewBranchRow,
  | 'code'
  | 'name'
  | 'gstin'
  | 'line1'
  | 'line2'
  | 'city'
  | 'pincode'
  | 'stateCode'
  | 'isHeadOffice'
  | 'isActive'
>;

/** Drizzle queries on `branches` (and the godown counts a branch's rules need). */
@Injectable()
export class BranchesRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  /**
   * Serialises the rules between branches and their godowns (one head office; no inactive branch
   * with active godowns), which span rows.
   */
  lockBranches(): Promise<void> {
    return lockTenantScope(this.db, 'branches');
  }

  async list(query: BranchListQuery): Promise<{ rows: BranchRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(branches)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'code:asc',
          {
            code: branches.code,
            name: branches.name,
            stateCode: branches.stateCode,
            createdAt: branches.createdAt,
          },
          branches.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize));
    const [totals] = await this.db.select({ total: count() }).from(branches).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<BranchRow | undefined> {
    const query = this.db.select().from(branches).where(eq(branches.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  async countActiveGodowns(branchId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(godowns)
      .where(and(eq(godowns.branchId, branchId), eq(godowns.isActive, true)));
    return row?.n ?? 0;
  }

  /** Clears the head-office flag of the current head office (before another branch takes it). */
  async clearHeadOffice(): Promise<void> {
    await this.db
      .update(branches)
      .set({ isHeadOffice: false, version: sql`${branches.version} + 1` })
      .where(eq(branches.isHeadOffice, true));
  }

  async insert(values: NewBranchRow): Promise<BranchRow> {
    const [row] = await this.db.insert(branches).values(values).returning();
    if (row === undefined) throw new Error('Branch insert returned no row');
    return row;
  }

  async update(id: string, changes: BranchChanges): Promise<BranchRow> {
    const [row] = await this.db
      .update(branches)
      .set({ ...changes, version: sql`${branches.version} + 1` })
      .where(eq(branches.id, id))
      .returning();
    if (row === undefined) throw new Error(`Branch ${id} vanished during its update`);
    return row;
  }
}

function filtersOf(query: BranchListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) {
    const pattern = containsPattern(query.q);
    const search = or(ilike(branches.code, pattern), ilike(branches.name, pattern));
    if (search !== undefined) filters.push(search);
  }
  if (query.active !== undefined) filters.push(eq(branches.isActive, query.active));
  return filters;
}
