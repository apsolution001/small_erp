import { ITEM_KINDS, ITEM_TYPES } from '@ekaro/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, text, unique, uuid } from 'drizzle-orm/pg-core';
import { inList, lengthBetween } from '../../../infra/db/checks.js';
import { qtyColumn, tenantTable } from '../../../infra/db/columns.js';
import { itemCategories } from '../item-categories/item-categories.schema.js';
import { units } from '../units/units.schema.js';

/**
 * Items (MS-02, spec 02 §2). Quantities and rates are `numeric(20,6)` strings end to end. The
 * checks mirror the contracts rules that need no other table; the HSN length against
 * `company_profile.hsn_min_digits` and the purchase/sales units against the conversions are
 * checked by the service.
 */
export const items = tenantTable(
  'items',
  {
    code: text().notNull(),
    name: text().notNull(),
    description: text(),
    itemType: text({ enum: ITEM_TYPES }).notNull(),
    itemKind: text({ enum: ITEM_KINDS }).notNull(),
    categoryId: uuid(),
    /** HSN (goods) or SAC (services), digits only. */
    hsnSac: text().notNull(),
    baseUnitId: uuid().notNull(),
    purchaseUnitId: uuid(),
    salesUnitId: uuid(),
    reorderLevel: qtyColumn(),
    reorderQty: qtyColumn(),
    minOrderQty: qtyColumn(),
    trackBatches: boolean().notNull().default(false),
    trackExpiry: boolean().notNull().default(false),
    standardPurchaseRate: qtyColumn(),
    standardSalesRate: qtyColumn(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('items_tenant_code_unique').on(t.tenantId, t.code),
    unique('items_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'items_category_fk',
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [itemCategories.tenantId, itemCategories.id],
    }),
    foreignKey({
      name: 'items_base_unit_fk',
      columns: [t.tenantId, t.baseUnitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    foreignKey({
      name: 'items_purchase_unit_fk',
      columns: [t.tenantId, t.purchaseUnitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    foreignKey({
      name: 'items_sales_unit_fk',
      columns: [t.tenantId, t.salesUnitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    index('items_tenant_category_idx').on(t.tenantId, t.categoryId),
    index('items_tenant_base_unit_idx').on(t.tenantId, t.baseUnitId),
    index('items_tenant_purchase_unit_idx').on(t.tenantId, t.purchaseUnitId),
    index('items_tenant_sales_unit_idx').on(t.tenantId, t.salesUnitId),
    index('items_tenant_name_idx').on(t.tenantId, t.name),
    index('items_tenant_hsn_sac_idx').on(t.tenantId, t.hsnSac),
    check('items_code_length', lengthBetween(t.code, 1, 30)),
    check('items_name_length', lengthBetween(t.name, 1, 200)),
    check('items_description_length', lengthBetween(t.description, 1, 1000)),
    check('items_item_type_valid', inList(t.itemType, ITEM_TYPES)),
    check('items_item_kind_valid', inList(t.itemKind, ITEM_KINDS)),
    check('items_service_kind', sql`(${t.itemType} = 'service') = (${t.itemKind} = 'service')`),
    check(
      'items_hsn_sac_format',
      sql`(${t.itemType} = 'goods' and ${t.hsnSac} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$')
        or (${t.itemType} = 'service' and ${t.hsnSac} ~ '^99[0-9]{4}$')`,
    ),
    check('items_expiry_needs_batches', sql`not ${t.trackExpiry} or ${t.trackBatches}`),
    check('items_service_no_batches', sql`${t.itemType} <> 'service' or not ${t.trackBatches}`),
    check(
      'items_quantities_non_negative',
      sql`${t.reorderLevel} >= 0 and ${t.reorderQty} >= 0 and ${t.minOrderQty} >= 0`,
    ),
    check(
      'items_rates_non_negative',
      sql`${t.standardPurchaseRate} >= 0 and ${t.standardSalesRate} >= 0`,
    ),
  ],
);

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
