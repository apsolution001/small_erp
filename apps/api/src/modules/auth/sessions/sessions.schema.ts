import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../../../infra/db/base-columns.js';
import { inList } from '../../../infra/db/checks.js';
import { memberships } from '../../access/memberships/memberships.schema.js';
import { users } from '../users/users.schema.js';

/** Why a session ended. */
export const SESSION_REVOKE_REASONS = [
  'logout',
  /** A revoked refresh token of the session was presented again (ADR 0006). */
  'reuse_detected',
  /** The session moved to another tenant (switch-tenant); a new session replaced it. */
  'switched',
  /** The user, membership or tenant is no longer active. */
  'access_revoked',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/**
 * A login session: one refresh-token family (ADR 0016). Its `id` is the family id and the access
 * token's `sid`. Rotation, logout, reuse detection and switch-tenant all lock this row first, so
 * a family can never gain a live token after it was revoked. Platform table.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    membershipId: uuid().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    /** Login time plus `SESSION_ABSOLUTE_DAYS`; no refresh token outlives it. */
    absoluteExpiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    revokedReason: text({ enum: SESSION_REVOKE_REASONS }),
  },
  (t) => [
    // The membership must be the session user's own.
    foreignKey({
      name: 'sessions_membership_user_fk',
      columns: [t.membershipId, t.userId],
      foreignColumns: [memberships.id, memberships.userId],
    }),
    index('sessions_user_idx').on(t.userId),
    index('sessions_membership_idx').on(t.membershipId),
    check('sessions_revoked_reason_valid', inList(t.revokedReason, SESSION_REVOKE_REASONS)),
    check(
      'sessions_revocation_complete',
      sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`,
    ),
    check('sessions_absolute_after_created', sql`${t.absoluteExpiresAt} > ${t.createdAt}`),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
