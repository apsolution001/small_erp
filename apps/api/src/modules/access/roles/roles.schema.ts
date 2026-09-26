import { sql } from 'drizzle-orm';
import { boolean, check, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { lengthBetween } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';

/**
 * Tenant roles (spec 01 §1, ADR 0007). `permissions` holds catalogue strings, validated by the
 * API against `@ekaro/contracts`. The Owner role (`is_owner`) stores none: its effective
 * permissions are the whole catalogue, computed. Readable by `ekaro_platform` (`platform_read`).
 */
export const roles = tenantTable(
  'roles',
  {
    name: text().notNull(),
    description: text(),
    permissions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Seeded from the BRD §8.1 templates at tenant creation. */
    isSystem: boolean().notNull().default(false),
    /** The one Owner role of the tenant: all permissions, never edited or deleted. */
    isOwner: boolean().notNull().default(false),
    /** Counts toward per-user billing (BRD §12): CA and Viewer are free. */
    isBillable: boolean().notNull().default(true),
  },
  (t) => [
    unique('roles_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('roles_tenant_name_unique').on(t.tenantId, sql`lower(${t.name})`),
    uniqueIndex('roles_one_owner')
      .on(t.tenantId)
      .where(sql`${t.isOwner}`),
    check('roles_name_length', lengthBetween(t.name, 1, 50)),
    check('roles_description_length', lengthBetween(t.description, 1, 200)),
    check('roles_owner_is_system', sql`not ${t.isOwner} or ${t.isSystem}`),
    check(
      'roles_owner_stores_no_permissions',
      sql`not ${t.isOwner} or cardinality(${t.permissions}) = 0`,
    ),
  ],
);

export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
