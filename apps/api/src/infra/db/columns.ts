import { type BuildExtraConfigColumns, sql } from 'drizzle-orm';
import {
  integer,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgTable,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from '../../modules/platform/tenants/tenants.schema.js';
import { primaryId, timestamptz, updatedAt } from './base-columns.js';

export { primaryId, timestamps, timestamptz } from './base-columns.js';

/**
 * Columns every tenant-owned table starts with (docs/standards/database.md).
 * `tenant_id`, `created_by` and `updated_by` default to the transaction context
 * (`app_current_tenant()` / `app_current_user()`), so repositories never pass them and the
 * tenant can never come from request input. RLS `with check` still rejects a foreign value.
 */
const tenantKeyColumns = () => ({
  id: primaryId(),
  tenantId: uuid()
    .notNull()
    .default(sql`app_current_tenant()`)
    .references(() => tenants.id),
});

const tenantAuditColumns = () => ({
  createdAt: timestamptz().notNull().defaultNow(),
  createdBy: uuid().default(sql`app_current_user()`),
  updatedAt: updatedAt(),
  updatedBy: uuid()
    .default(sql`app_current_user()`)
    .$onUpdate(() => sql`app_current_user()`),
  /** Optimistic lock: updates send the version they read; a mismatch is a 409. */
  version: integer().notNull().default(1),
});

export type TenantColumns = ReturnType<typeof tenantKeyColumns> &
  ReturnType<typeof tenantAuditColumns>;

/** Business columns may not redefine the standard ones. */
type BusinessColumns<T> = T & { [K in keyof TenantColumns]?: never };

/**
 * `pgTable` for a tenant-owned table: `id`, `tenant_id`, your columns, then the audit columns
 * and `version`. Its migration must also run `select app_enable_tenant_table('<name>')`
 * (RLS enable + force, `tenant_isolation` policy, grants to ekaro_app, audit trigger).
 */
export function tenantTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TName,
  columns: BusinessColumns<TColumns>,
  extraConfig?: (
    self: BuildExtraConfigColumns<TName, TenantColumns & TColumns, 'pg'>,
  ) => PgTableExtraConfigValue[],
) {
  return pgTable(name, { ...tenantKeyColumns(), ...columns, ...tenantAuditColumns() }, extraConfig);
}
