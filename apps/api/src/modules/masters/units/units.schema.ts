import { UQC_CODES } from '@ekaro/core';
import { sql } from 'drizzle-orm';
import { boolean, check, smallint, text, unique } from 'drizzle-orm/pg-core';
import { inList, lengthBetween } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';

/** Units of measure, each mapped to a GST UQC (spec 02 §2). */
export const units = tenantTable(
  'units',
  {
    code: text().notNull(),
    name: text().notNull(),
    uqc: text({ enum: UQC_CODES }).notNull(),
    decimalPlaces: smallint().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('units_tenant_code_unique').on(t.tenantId, t.code),
    check('units_code_format', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{0,9}$'`),
    check('units_name_length', lengthBetween(t.name, 1, 50)),
    check('units_uqc_valid', inList(t.uqc, UQC_CODES)),
    check('units_decimal_places_range', sql`${t.decimalPlaces} between 0 and 6`),
  ],
);

export type UnitRow = typeof units.$inferSelect;
export type NewUnitRow = typeof units.$inferInsert;
