import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { lengthBetween } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';

/**
 * Item categories, a tree at most 3 levels deep (spec 02 §2). The depth and the absence of cycles
 * need the parent chain, so the service checks them under a tenant lock; the table guarantees the
 * rest: the parent is in the same tenant, and names are unique per parent (case-insensitively).
 */
export const itemCategories = tenantTable(
  'item_categories',
  {
    /** Null for a root category. */
    parentId: uuid(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('item_categories_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'item_categories_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    // Roots share the nil uuid as their "parent", so two roots cannot have the same name either.
    uniqueIndex('item_categories_name_per_parent').on(
      t.tenantId,
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    index('item_categories_tenant_parent_idx').on(t.tenantId, t.parentId),
    check('item_categories_name_length', lengthBetween(t.name, 1, 100)),
    check('item_categories_not_own_parent', sql`${t.parentId} <> ${t.id}`),
  ],
);

export type ItemCategoryRow = typeof itemCategories.$inferSelect;
export type NewItemCategoryRow = typeof itemCategories.$inferInsert;
