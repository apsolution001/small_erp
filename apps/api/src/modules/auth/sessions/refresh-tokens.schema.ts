import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../../../infra/db/base-columns.js';
import { inList } from '../../../infra/db/checks.js';
import { memberships } from '../../access/memberships/memberships.schema.js';
import { users } from '../users/users.schema.js';

/** Why a refresh token stopped being usable. */
export const REFRESH_REVOKE_REASONS = [
  /** Exchanged for its successor (normal rotation). */
  'rotated',
  'logout',
  /** A revoked token was presented again: the whole family is revoked (ADR 0006). */
  'reuse_detected',
  /** The session moved to another tenant (switch-tenant). */
  'switched',
  /** The user, membership or tenant is no longer active. */
  'access_revoked',
] as const;
export type RefreshRevokeReason = (typeof REFRESH_REVOKE_REASONS)[number];

/**
 * Opaque refresh tokens, stored only as SHA-256 hashes (ADR 0006). A family is one login session
 * (`family_id` = the access token's `sid`): every rotation adds a row to it. Platform table.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id),
    familyId: uuid().notNull(),
    /** Hex SHA-256 of the token. The token itself is never stored. */
    tokenHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    revokedReason: text({ enum: REFRESH_REVOKE_REASONS }),
    /** The token issued when this one was rotated. */
    replacedById: uuid(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('refresh_tokens_token_hash_unique').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_membership_idx').on(t.membershipId),
    check('refresh_tokens_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('refresh_tokens_revoked_reason_valid', inList(t.revokedReason, REFRESH_REVOKE_REASONS)),
    check(
      'refresh_tokens_revocation_complete',
      sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`,
    ),
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenRow = typeof refreshTokens.$inferInsert;
