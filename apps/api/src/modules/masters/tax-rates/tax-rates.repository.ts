import { type TaxRateListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { type NewTaxRateRow, type TaxRateRow, taxRates } from './tax-rates.schema.js';

/** Only the name and the active flag of a slab ever change (spec 02 §2). */
export type TaxRateChanges = RowChanges<NewTaxRateRow, 'name' | 'isActive'>;

/** Drizzle queries on `tax_rates`, in the request's tenant transaction. */
@Injectable()
export class TaxRatesRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  async list(query: TaxRateListQuery): Promise<{ rows: TaxRateRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(taxRates)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'gstRate:asc',
          { name: taxRates.name, gstRate: taxRates.gstRate, createdAt: taxRates.createdAt },
          taxRates.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize));
    const [totals] = await this.db.select({ total: count() }).from(taxRates).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<TaxRateRow | undefined> {
    const query = this.db.select().from(taxRates).where(eq(taxRates.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  async insert(values: NewTaxRateRow): Promise<TaxRateRow> {
    const [row] = await this.db.insert(taxRates).values(values).returning();
    if (row === undefined) throw new Error('Tax rate insert returned no row');
    return row;
  }

  async update(id: string, changes: TaxRateChanges): Promise<TaxRateRow> {
    const [row] = await this.db
      .update(taxRates)
      .set({ ...changes, version: sql`${taxRates.version} + 1` })
      .where(eq(taxRates.id, id))
      .returning();
    if (row === undefined) throw new Error(`Tax rate ${id} vanished during its update`);
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(taxRates)
      .where(eq(taxRates.id, id))
      .returning({ id: taxRates.id });
    return deleted.length > 0;
  }
}

function filtersOf(query: TaxRateListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) filters.push(ilike(taxRates.name, containsPattern(query.q)));
  if (query.active !== undefined) filters.push(eq(taxRates.isActive, query.active));
  return filters;
}
