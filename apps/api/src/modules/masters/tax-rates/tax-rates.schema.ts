import { sql } from 'drizzle-orm';
import { boolean, check, numeric, text, unique } from 'drizzle-orm/pg-core';
import { lengthBetween } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';

/**
 * GST slab definitions (spec 02 §2). `gst_rate` is the total rate: CGST = SGST = rate / 2 and
 * IGST = rate are derived, never stored. Percentages are `numeric(7,4)` (database standard).
 * The rate columns and the three flags are immutable once inserted (a trigger enforces it; a rate
 * change is a new slab plus an effective-dated `item_tax_rates` row).
 */
export const taxRates = tenantTable(
  'tax_rates',
  {
    name: text().notNull(),
    gstRate: numeric({ precision: 7, scale: 4 }).notNull(),
    cessRate: numeric({ precision: 7, scale: 4 }).notNull().default('0'),
    isExempt: boolean().notNull().default(false),
    isNilRated: boolean().notNull().default(false),
    isNonGst: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('tax_rates_tenant_slab_unique').on(
      t.tenantId,
      t.gstRate,
      t.cessRate,
      t.isExempt,
      t.isNilRated,
      t.isNonGst,
    ),
    // Target of the composite foreign key from item_tax_rates.
    unique('tax_rates_tenant_id_unique').on(t.tenantId, t.id),
    check('tax_rates_name_length', lengthBetween(t.name, 1, 50)),
    check('tax_rates_gst_rate_range', sql`${t.gstRate} between 0 and 100`),
    check('tax_rates_cess_rate_non_negative', sql`${t.cessRate} >= 0`),
    check(
      'tax_rates_one_special_kind',
      sql`${t.isExempt}::int + ${t.isNilRated}::int + ${t.isNonGst}::int <= 1`,
    ),
    check(
      'tax_rates_special_kind_untaxed',
      sql`not (${t.isExempt} or ${t.isNilRated} or ${t.isNonGst}) or (${t.gstRate} = 0 and ${t.cessRate} = 0)`,
    ),
  ],
);

export type TaxRateRow = typeof taxRates.$inferSelect;
export type NewTaxRateRow = typeof taxRates.$inferInsert;
