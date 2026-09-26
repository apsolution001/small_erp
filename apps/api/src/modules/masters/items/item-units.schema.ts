import { sql } from 'drizzle-orm';
import { check, foreignKey, index, unique, uuid } from 'drizzle-orm/pg-core';
import { qtyColumn, tenantTable } from '../../../infra/db/columns.js';
import { units } from '../units/units.schema.js';
import { items } from './items.schema.js';

/**
 * UoM conversions of an item (spec 02 §2): one row per non-base unit, `factor_to_base` base units
 * per unit (item base KGS, BAG = 50). The base unit has an implicit factor of 1 and no row.
 */
export const itemUnits = tenantTable(
  'item_units',
  {
    itemId: uuid().notNull(),
    unitId: uuid().notNull(),
    factorToBase: qtyColumn().notNull(),
  },
  (t) => [
    unique('item_units_item_unit_unique').on(t.tenantId, t.itemId, t.unitId),
    foreignKey({
      name: 'item_units_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }),
    foreignKey({
      name: 'item_units_unit_fk',
      columns: [t.tenantId, t.unitId],
      foreignColumns: [units.tenantId, units.id],
    }),
    index('item_units_tenant_unit_idx').on(t.tenantId, t.unitId),
    check('item_units_factor_positive', sql`${t.factorToBase} > 0`),
  ],
);

export type ItemUnitRow = typeof itemUnits.$inferSelect;
export type NewItemUnitRow = typeof itemUnits.$inferInsert;
