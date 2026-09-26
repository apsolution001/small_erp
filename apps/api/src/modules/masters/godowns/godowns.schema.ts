import { boolean, check, foreignKey, index, text, unique, uuid } from 'drizzle-orm/pg-core';
import { lengthBetween } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';
import { branches } from '../branches/branches.schema.js';

/** Godowns (warehouses) of a branch (spec 02 §2). */
export const godowns = tenantTable(
  'godowns',
  {
    branchId: uuid().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    address: text(),
    allowNegativeStock: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('godowns_tenant_code_unique').on(t.tenantId, t.code),
    foreignKey({
      name: 'godowns_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    index('godowns_tenant_branch_idx').on(t.tenantId, t.branchId),
    check('godowns_code_length', lengthBetween(t.code, 1, 10)),
    check('godowns_name_length', lengthBetween(t.name, 1, 100)),
    check('godowns_address_length', lengthBetween(t.address, 1, 300)),
  ],
);

export type GodownRow = typeof godowns.$inferSelect;
export type NewGodownRow = typeof godowns.$inferInsert;
