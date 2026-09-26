import { type ItemListQuery, type ItemUnit } from '@ekaro/contracts';
import { toDecimal } from '@ekaro/core';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, count, desc, eq, ilike, inArray, lte, or, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import {
  containsPattern,
  orderByOf,
  pageOffset,
  prefixPattern,
} from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import {
  itemTaxRates,
  type ItemTaxRateRow,
  type NewItemTaxRateRow,
} from './item-tax-rates.schema.js';
import { itemUnits, type ItemUnitRow } from './item-units.schema.js';
import { type ItemRow, items, type NewItemRow } from './items.schema.js';

/** The item columns a PATCH may write (the conversions are written separately). */
export type ItemChanges = RowChanges<
  NewItemRow,
  | 'code'
  | 'name'
  | 'description'
  | 'itemType'
  | 'itemKind'
  | 'categoryId'
  | 'hsnSac'
  | 'baseUnitId'
  | 'purchaseUnitId'
  | 'salesUnitId'
  | 'reorderLevel'
  | 'reorderQty'
  | 'minOrderQty'
  | 'trackBatches'
  | 'trackExpiry'
  | 'standardPurchaseRate'
  | 'standardSalesRate'
  | 'isActive'
>;

/**
 * Drizzle queries on `items` and its child tables `item_units` and `item_tax_rates`, which the
 * item aggregate owns. Always in the request's tenant transaction.
 */
@Injectable()
export class ItemsRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  async list(query: ItemListQuery): Promise<{ rows: ItemRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(items)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'code:asc',
          { code: items.code, name: items.name, hsnSac: items.hsnSac, createdAt: items.createdAt },
          items.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query));
    const [totals] = await this.db.select({ total: count() }).from(items).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<ItemRow | undefined> {
    const query = this.db.select().from(items).where(eq(items.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  async insert(values: NewItemRow): Promise<ItemRow> {
    const [row] = await this.db.insert(items).values(values).returning();
    if (row === undefined) throw new Error('Item insert returned no row');
    return row;
  }

  async update(id: string, changes: ItemChanges): Promise<ItemRow> {
    const [row] = await this.db
      .update(items)
      .set({ ...changes, version: sql`${items.version} + 1` })
      .where(eq(items.id, id))
      .returning();
    if (row === undefined) throw new Error(`Item ${id} vanished during its update`);
    return row;
  }

  /** The conversions of each item, in insertion order (one query for a whole page). */
  async unitsOf(itemIds: readonly string[]): Promise<ItemUnitRow[]> {
    if (itemIds.length === 0) return [];
    return this.db
      .select()
      .from(itemUnits)
      .where(inArray(itemUnits.itemId, [...itemIds]))
      .orderBy(asc(itemUnits.id));
  }

  /**
   * Makes the item's conversions exactly `desired`: deletes the dropped units, updates changed
   * factors and inserts new units, so the audit log shows what really changed.
   */
  async replaceUnits(itemId: string, desired: readonly ItemUnit[]): Promise<void> {
    const current = await this.unitsOf([itemId]);
    const wanted = new Map(desired.map((u) => [u.unitId, u.factorToBase]));
    const dropped = current.filter((row) => !wanted.has(row.unitId)).map((row) => row.id);
    if (dropped.length > 0) await this.db.delete(itemUnits).where(inArray(itemUnits.id, dropped));
    for (const row of current) {
      const factor = wanted.get(row.unitId);
      if (factor !== undefined && !toDecimal(factor).equals(row.factorToBase)) {
        await this.db
          .update(itemUnits)
          .set({ factorToBase: factor, version: sql`${itemUnits.version} + 1` })
          .where(eq(itemUnits.id, row.id));
      }
    }
    const existing = new Set(current.map((row) => row.unitId));
    const added = desired.filter((u) => !existing.has(u.unitId));
    if (added.length > 0) {
      await this.db.insert(itemUnits).values(added.map((u) => ({ itemId, ...u })));
    }
  }

  /** The effective-dated GST rows of each item, oldest first. */
  async taxRatesOf(itemIds: readonly string[]): Promise<ItemTaxRateRow[]> {
    if (itemIds.length === 0) return [];
    return this.db
      .select()
      .from(itemTaxRates)
      .where(inArray(itemTaxRates.itemId, [...itemIds]))
      .orderBy(asc(itemTaxRates.effectiveFrom));
  }

  /** The row in force on `on`: the latest `effective_from <= on` (none before the first row). */
  async taxRateOn(itemId: string, on: string): Promise<ItemTaxRateRow | undefined> {
    const [row] = await this.db
      .select()
      .from(itemTaxRates)
      .where(and(eq(itemTaxRates.itemId, itemId), lte(itemTaxRates.effectiveFrom, on)))
      .orderBy(desc(itemTaxRates.effectiveFrom))
      .limit(1);
    return row;
  }

  async insertTaxRate(values: NewItemTaxRateRow): Promise<ItemTaxRateRow> {
    const [row] = await this.db.insert(itemTaxRates).values(values).returning();
    if (row === undefined) throw new Error('Item tax rate insert returned no row');
    return row;
  }
}

function filtersOf(query: ItemListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) {
    const contains = containsPattern(query.q);
    const search = or(
      ilike(items.code, contains),
      ilike(items.name, contains),
      ilike(items.hsnSac, prefixPattern(query.q)),
    );
    if (search !== undefined) filters.push(search);
  }
  if (query.kind !== undefined) filters.push(eq(items.itemKind, query.kind));
  if (query.type !== undefined) filters.push(eq(items.itemType, query.type));
  if (query.categoryId !== undefined) filters.push(eq(items.categoryId, query.categoryId));
  if (query.active !== undefined) filters.push(eq(items.isActive, query.active));
  return filters;
}
