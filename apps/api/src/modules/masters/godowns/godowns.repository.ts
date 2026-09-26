import { type GodownListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { type GodownRow, godowns, type NewGodownRow } from './godowns.schema.js';

export type GodownChanges = RowChanges<
  NewGodownRow,
  'branchId' | 'code' | 'name' | 'address' | 'allowNegativeStock' | 'isActive'
>;

/** Drizzle queries on `godowns`, in the request's tenant transaction. */
@Injectable()
export class GodownsRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  async list(query: GodownListQuery): Promise<{ rows: GodownRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(godowns)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'code:asc',
          { code: godowns.code, name: godowns.name, createdAt: godowns.createdAt },
          godowns.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query));
    const [totals] = await this.db.select({ total: count() }).from(godowns).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<GodownRow | undefined> {
    const query = this.db.select().from(godowns).where(eq(godowns.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  async insert(values: NewGodownRow): Promise<GodownRow> {
    const [row] = await this.db.insert(godowns).values(values).returning();
    if (row === undefined) throw new Error('Godown insert returned no row');
    return row;
  }

  async update(id: string, changes: GodownChanges): Promise<GodownRow> {
    const [row] = await this.db
      .update(godowns)
      .set({ ...changes, version: sql`${godowns.version} + 1` })
      .where(eq(godowns.id, id))
      .returning();
    if (row === undefined) throw new Error(`Godown ${id} vanished during its update`);
    return row;
  }
}

function filtersOf(query: GodownListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) {
    const pattern = containsPattern(query.q);
    const search = or(ilike(godowns.code, pattern), ilike(godowns.name, pattern));
    if (search !== undefined) filters.push(search);
  }
  if (query.branchId !== undefined) filters.push(eq(godowns.branchId, query.branchId));
  if (query.active !== undefined) filters.push(eq(godowns.isActive, query.active));
  return filters;
}
