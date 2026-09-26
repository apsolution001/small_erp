import { type UnitListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { type NewUnitRow, type UnitRow, units } from './units.schema.js';

/** The fields a PATCH may write (identity and audit columns are never set by the service). */
export type UnitChanges = RowChanges<
  NewUnitRow,
  'code' | 'name' | 'uqc' | 'decimalPlaces' | 'isActive'
>;

/**
 * Drizzle queries on `units`, always in the request's tenant transaction (`txHost.tx`), so RLS
 * scopes every statement to the tenant. Returns rows; mapping to contracts is the service's job.
 */
@Injectable()
export class UnitsRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  async list(query: UnitListQuery): Promise<{ rows: UnitRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(units)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'code:asc',
          { code: units.code, name: units.name, createdAt: units.createdAt },
          units.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize));
    const [totals] = await this.db.select({ total: count() }).from(units).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  /** `forUpdate` locks the row until the transaction ends (read-check-write of an update). */
  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<UnitRow | undefined> {
    const query = this.db.select().from(units).where(eq(units.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  /** The active units among `ids` (items may only start using an active unit). */
  async findActiveIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: units.id })
      .from(units)
      .where(and(inArray(units.id, [...ids]), eq(units.isActive, true)));
    return new Set(rows.map((r) => r.id));
  }

  async insert(values: NewUnitRow): Promise<UnitRow> {
    const [row] = await this.db.insert(units).values(values).returning();
    if (row === undefined) throw new Error('Unit insert returned no row');
    return row;
  }

  /** Writes the changes and bumps the optimistic-lock version. */
  async update(id: string, changes: UnitChanges): Promise<UnitRow> {
    const [row] = await this.db
      .update(units)
      .set({ ...changes, version: sql`${units.version} + 1` })
      .where(eq(units.id, id))
      .returning();
    if (row === undefined) throw new Error(`Unit ${id} vanished during its update`);
    return row;
  }

  /** Hard delete; returns false when there was no such unit. */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.delete(units).where(eq(units.id, id)).returning({ id: units.id });
    return deleted.length > 0;
  }
}

function filtersOf(query: UnitListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) {
    const pattern = containsPattern(query.q);
    const search = or(ilike(units.code, pattern), ilike(units.name, pattern));
    if (search !== undefined) filters.push(search);
  }
  if (query.active !== undefined) filters.push(eq(units.isActive, query.active));
  return filters;
}
