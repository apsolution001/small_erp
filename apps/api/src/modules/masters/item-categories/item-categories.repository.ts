import { type ItemCategoryListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, count, eq, ilike, inArray, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { lockTenantScope } from '../../../infra/db/tenant-lock.js';
import {
  itemCategories,
  type ItemCategoryRow,
  type NewItemCategoryRow,
} from './item-categories.schema.js';

export type ItemCategoryChanges = RowChanges<NewItemCategoryRow, 'parentId' | 'name' | 'isActive'>;

/** A bound on tree walks, well above the 3 allowed levels, so corrupt data cannot loop forever. */
const WALK_LIMIT = 16;

/** Drizzle queries on `item_categories`, in the request's tenant transaction. */
@Injectable()
export class ItemCategoriesRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  /** Serialises changes to the tree's shape (depth and cycles span several rows). */
  lockTree(): Promise<void> {
    return lockTenantScope(this.db, 'item_categories');
  }

  async list(query: ItemCategoryListQuery): Promise<{ rows: ItemCategoryRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(itemCategories)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'name:asc',
          { name: itemCategories.name, createdAt: itemCategories.createdAt },
          itemCategories.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize));
    const [totals] = await this.db.select({ total: count() }).from(itemCategories).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  /** Every category (optionally only active ones), for the tree view. */
  listAll(active: boolean | undefined): Promise<ItemCategoryRow[]> {
    return this.db
      .select()
      .from(itemCategories)
      .where(active === undefined ? undefined : eq(itemCategories.isActive, active))
      .orderBy(asc(itemCategories.name), asc(itemCategories.id));
  }

  async findById(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<ItemCategoryRow | undefined> {
    const query = this.db.select().from(itemCategories).where(eq(itemCategories.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  /** Levels from the root down to `id` (1 for a root category). */
  async depthOf(id: string): Promise<number> {
    const { rows } = await this.db.execute<{ depth: number }>(sql`
      with recursive chain (id, parent_id, depth) as (
        select id, parent_id, 1 from ${itemCategories} where id = ${id}
        union all
        select c.id, c.parent_id, chain.depth + 1
          from ${itemCategories} c join chain on c.id = chain.parent_id
         where chain.depth < ${WALK_LIMIT}
      )
      select coalesce(max(depth), 0)::int as depth from chain`);
    return rows[0]?.depth ?? 0;
  }

  /** The ids in the subtree rooted at `id` (itself included) and its height (1 for a leaf). */
  async subtreeOf(id: string): Promise<{ ids: Set<string>; height: number }> {
    const { rows } = await this.db.execute<{ id: string; level: number }>(sql`
      with recursive sub (id, level) as (
        select id, 1 from ${itemCategories} where id = ${id}
        union all
        select c.id, sub.level + 1
          from ${itemCategories} c join sub on c.parent_id = sub.id
         where sub.level < ${WALK_LIMIT}
      )
      select id, level from sub`);
    return {
      ids: new Set(rows.map((r) => r.id)),
      height: rows.reduce((max, r) => Math.max(max, r.level), 0),
    };
  }

  /** The active categories among `ids`, for items that start using a category. */
  async findActiveIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: itemCategories.id })
      .from(itemCategories)
      .where(and(inArray(itemCategories.id, [...ids]), eq(itemCategories.isActive, true)));
    return new Set(rows.map((r) => r.id));
  }

  async insert(values: NewItemCategoryRow): Promise<ItemCategoryRow> {
    const [row] = await this.db.insert(itemCategories).values(values).returning();
    if (row === undefined) throw new Error('Item category insert returned no row');
    return row;
  }

  async update(id: string, changes: ItemCategoryChanges): Promise<ItemCategoryRow> {
    const [row] = await this.db
      .update(itemCategories)
      .set({ ...changes, version: sql`${itemCategories.version} + 1` })
      .where(eq(itemCategories.id, id))
      .returning();
    if (row === undefined) throw new Error(`Item category ${id} vanished during its update`);
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(itemCategories)
      .where(eq(itemCategories.id, id))
      .returning({ id: itemCategories.id });
    return deleted.length > 0;
  }
}

function filtersOf(query: ItemCategoryListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) filters.push(ilike(itemCategories.name, containsPattern(query.q)));
  if (query.parentId !== undefined) filters.push(eq(itemCategories.parentId, query.parentId));
  if (query.active !== undefined) filters.push(eq(itemCategories.isActive, query.active));
  return filters;
}
