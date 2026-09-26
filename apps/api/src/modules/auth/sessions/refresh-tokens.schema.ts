import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../../../infra/db/base-columns.js';
import { inList } from '../../../infra/db/checks.js';
import { SESSION_REVOKE_REASONS, sessions } from './sessions.schema.js';

/**
 * Why a refresh token stopped being usable: exchanged for its successor (`rotated`), or its
 * session ended for one of the session reasons.
 */
export const REFRESH_REVOKE_REASONS = ['rotated', ...SESSION_REVOKE_REASONS] as const;
export type RefreshRevokeReason = (typeof REFRESH_REVOKE_REASONS)[number];

/**
 * Opaque refresh tokens, stored only as SHA-256 hashes (ADR 0006). A family is one login session
 * (`family_id` = `sessions.id` = the access token's `sid`): every rotation adds a row to it. The
 * user and membership are the session's. Platform table.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    familyId: uuid()
      .notNull()
      .references(() => sessions.id),
    /** Hex SHA-256 of the token. The token itself is never stored. */
    tokenHash: text().notNull(),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    revokedReason: text({ enum: REFRESH_REVOKE_REASONS }),
    /** The token issued when this one was rotated (same family). */
    replacedById: uuid(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('refresh_tokens_token_hash_unique').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    foreignKey({
      name: 'refresh_tokens_replaced_by_fk',
      columns: [t.replacedById],
      foreignColumns: [t.id],
    }),
    index('refresh_tokens_replaced_by_idx').on(t.replacedById),
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
