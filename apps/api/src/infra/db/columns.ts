import { type BuildColumns, type BuildExtraConfigColumns, sql } from 'drizzle-orm';
import {
  integer,
  numeric,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  pgTable,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from '../../modules/platform/tenants/tenants.schema.js';
import { primaryId, timestamptz, updatedAt } from './base-columns.js';

export { primaryId, timestamps, timestamptz } from './base-columns.js';

/**
 * `numeric(20,6)`: quantities and unit rates (database standard, ADR 0005). Drizzle reads and
 * writes it as a string, so decimal values never pass through a JS number.
 */
export const qtyColumn = () => numeric({ precision: 20, scale: 6 });

/**
 * `tenant_id uuid not null default app_current_tenant() references tenants(id)`. For tenant tables
 * whose key is not a plain `id` (a per-tenant singleton, a link table); others use {@link tenantTable}.
 */
export const tenantIdColumn = () =>
  uuid()
    .notNull()
    .default(sql`app_current_tenant()`)
    .references(() => tenants.id);

/**
 * Columns every tenant-owned table starts with (docs/standards/database.md).
 * `tenant_id`, `created_by` and `updated_by` default to the transaction context
 * (`app_current_tenant()` / `app_current_user()`), so repositories never pass them and the
 * tenant can never come from request input. RLS `with check` still rejects a foreign value.
 */
const tenantKeyColumns = () => ({
  id: primaryId(),
  tenantId: tenantIdColumn(),
});

/** `created_*`, `updated_*` (actor from the transaction context) and `version`. */
export const tenantAuditColumns = () => ({
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

/** The table type `pgTable` would give the standard columns plus the business columns. */
export type TenantTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
> = PgTableWithColumns<{
  name: TName;
  schema: undefined;
  columns: BuildColumns<TName, TenantColumns & TColumns, 'pg'>;
  dialect: 'pg';
}>;

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
): TenantTable<TName, TColumns> {
  // Stated explicitly: inferred from the spread, the `never` guard above would erase the standard
  // columns from the table's type (the runtime table always had them).
  const business: TColumns = columns;
  const all: TenantColumns & TColumns = {
    ...tenantKeyColumns(),
    ...business,
    ...tenantAuditColumns(),
  };
  return pgTable(name, all, extraConfig);
}
