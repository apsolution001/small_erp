import { sql } from 'drizzle-orm';
import { boolean, char, check, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  gstinFormat,
  lengthBetween,
  pincodeFormat,
  stateCodeFormat,
} from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';

/** Branches (spec 02 §2). Exactly one head office per tenant. */
export const branches = tenantTable(
  'branches',
  {
    code: text().notNull(),
    name: text().notNull(),
    /** A branch in another state has its own GSTIN, registered in the branch's state. */
    gstin: char({ length: 15 }),
    stateCode: char({ length: 2 }).notNull(),
    line1: text().notNull(),
    line2: text(),
    city: text().notNull(),
    pincode: char({ length: 6 }).notNull(),
    isHeadOffice: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('branches_tenant_code_unique').on(t.tenantId, t.code),
    // Target of composite foreign keys, so a row can only point at a branch of its own tenant.
    unique('branches_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('branches_one_head_office')
      .on(t.tenantId)
      .where(sql`${t.isHeadOffice}`),
    check('branches_code_length', lengthBetween(t.code, 1, 10)),
    check('branches_name_length', lengthBetween(t.name, 1, 100)),
    check('branches_gstin_format', gstinFormat(t.gstin)),
    check('branches_gstin_state', sql`left(${t.gstin}, 2) = ${t.stateCode}`),
    check('branches_state_code_format', stateCodeFormat(t.stateCode)),
    check('branches_pincode_format', pincodeFormat(t.pincode)),
    check('branches_head_office_active', sql`not ${t.isHeadOffice} or ${t.isActive}`),
  ],
);

export type BranchRow = typeof branches.$inferSelect;
export type NewBranchRow = typeof branches.$inferInsert;
