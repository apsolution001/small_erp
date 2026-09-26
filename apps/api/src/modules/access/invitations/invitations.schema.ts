import { sql } from 'drizzle-orm';
import { boolean, check, index, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, timestamptz } from '../../../infra/db/base-columns.js';
import { tenantTable } from '../../../infra/db/columns.js';

/**
 * Invitations to join a tenant (spec 01 §1, §3.3). The link carries an opaque 256-bit token; only
 * its SHA-256 is stored. Pending = neither accepted nor revoked (expiry is derived at read time).
 *
 * `role_id` references `roles (tenant_id, id)` through a composite foreign key declared in the
 * T-105 security migration, because it is `ON DELETE SET NULL (role_id)`, which Drizzle cannot
 * express: a role may be deleted once no pending invitation holds it, and the closed invitations
 * keep their history with a null role. `invitations_role_while_pending` forbids a null role on a
 * pending invitation, so the database refuses to delete a role a pending invitation holds.
 *
 * Readable by `ekaro_platform` (`platform_read`): accepting finds the invitation by its token hash
 * before any tenant is known.
 */
export const invitations = tenantTable(
  'invitations',
  {
    /** Lower-cased and trimmed by the contracts schema. */
    email: citext().notNull(),
    roleId: uuid(),
    allBranches: boolean().notNull().default(true),
    /** Branch scope when `all_branches` is false; checked against `branches` when used. */
    branchIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    tokenHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    revokedAt: timestamptz(),
  },
  (t) => [
    unique('invitations_tenant_id_unique').on(t.tenantId, t.id),
    unique('invitations_token_hash_unique').on(t.tokenHash),
    // One pending invitation per email and tenant: inviting again replaces (revokes) it.
    uniqueIndex('invitations_one_pending_per_email')
      .on(t.tenantId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index('invitations_tenant_role_idx').on(t.tenantId, t.roleId),
    index('invitations_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('invitations_email_normalised', sql`${t.email}::text = lower(btrim(${t.email}::text))`),
    check('invitations_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('invitations_branch_scope', sql`${t.allBranches} = (cardinality(${t.branchIds}) = 0)`),
    check('invitations_closed_once', sql`${t.acceptedAt} is null or ${t.revokedAt} is null`),
    check(
      'invitations_role_while_pending',
      sql`${t.roleId} is not null or ${t.acceptedAt} is not null or ${t.revokedAt} is not null`,
    ),
  ],
);

export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitationRow = typeof invitations.$inferInsert;
