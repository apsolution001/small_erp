import { date, foreignKey, index, unique, uuid } from 'drizzle-orm/pg-core';
import { tenantTable } from '../../../infra/db/columns.js';
import { taxRates } from '../tax-rates/tax-rates.schema.js';
import { items } from './items.schema.js';

/**
 * Effective-dated GST slab of an item (spec 02 §2): the slab applied on a document date is the
 * latest row with `effective_from <= date`. Rows are never edited or deleted (the migration
 * withholds UPDATE and DELETE from ekaro_app): a rate change adds a row.
 */
export const itemTaxRates = tenantTable(
  'item_tax_rates',
  {
    itemId: uuid().notNull(),
    taxRateId: uuid().notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
  },
  (t) => [
    // Also the index of the effective-date lookup (item, latest effective_from <= date).
    unique('item_tax_rates_item_effective_unique').on(t.tenantId, t.itemId, t.effectiveFrom),
    foreignKey({
      name: 'item_tax_rates_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }),
    foreignKey({
      name: 'item_tax_rates_tax_rate_fk',
      columns: [t.tenantId, t.taxRateId],
      foreignColumns: [taxRates.tenantId, taxRates.id],
    }),
    index('item_tax_rates_tenant_tax_rate_idx').on(t.tenantId, t.taxRateId),
  ],
);

export type ItemTaxRateRow = typeof itemTaxRates.$inferSelect;
export type NewItemTaxRateRow = typeof itemTaxRates.$inferInsert;
