import { MEMBERSHIP_STATUSES } from '@ekaro/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from '../../../infra/db/base-columns.js';
import { inList } from '../../../infra/db/checks.js';
import { tenantIdColumn, tenantTable } from '../../../infra/db/columns.js';
import { users } from '../../auth/users/users.schema.js';
import { branches } from '../../masters/branches/branches.schema.js';
import { roles } from '../roles/roles.schema.js';

/**
 * A user's access to one tenant: role and branch scope (ADR 0007). Readable by `ekaro_platform`
 * (`platform_read`) so login can list a user's tenants.
 */
export const memberships = tenantTable(
  'memberships',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id),
    roleId: uuid().notNull(),
    /** False: only the branches in `membership_branches`. */
    allBranches: boolean().notNull().default(true),
    status: text({ enum: MEMBERSHIP_STATUSES }).notNull().default('active'),
    invitedBy: uuid().references(() => users.id),
    joinedAt: timestamptz(),
  },
  (t) => [
    unique('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    unique('memberships_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'memberships_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }),
    index('memberships_user_idx').on(t.userId),
    index('memberships_tenant_role_idx').on(t.tenantId, t.roleId),
    index('memberships_invited_by_idx').on(t.invitedBy),
    check('memberships_status_valid', inList(t.status, MEMBERSHIP_STATUSES)),
    check(
      'memberships_joined_when_active',
      sql`${t.status} <> 'active' or ${t.joinedAt} is not null`,
    ),
  ],
);

/** Branch scope of a membership whose `all_branches` is false. Readable by `ekaro_platform`. */
export const membershipBranches = pgTable(
  'membership_branches',
  {
    tenantId: tenantIdColumn(),
    membershipId: uuid().notNull(),
    branchId: uuid().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    createdBy: uuid().default(sql`app_current_user()`),
  },
  (t) => [
    primaryKey({ name: 'membership_branches_pkey', columns: [t.membershipId, t.branchId] }),
    foreignKey({
      name: 'membership_branches_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'membership_branches_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    index('membership_branches_tenant_branch_idx').on(t.tenantId, t.branchId),
  ],
);

export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembershipRow = typeof memberships.$inferInsert;
