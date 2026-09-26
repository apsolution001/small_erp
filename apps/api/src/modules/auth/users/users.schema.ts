import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps, timestamptz } from '../../../infra/db/base-columns.js';
import { inList, lengthBetween } from '../../../infra/db/checks.js';

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Global users (ADR 0006): one login by email, memberships in any number of tenants. Platform
 * table: only `ekaro_platform` can reach it (migration 0004).
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    /** Lower-cased and trimmed by the contracts schema; citext makes lookups case-insensitive. */
    email: citext().notNull().unique(),
    /** E.164 `+91XXXXXXXXXX`. Not unique: shared office phones exist. */
    mobile: text(),
    fullName: text().notNull(),
    /** bcrypt, cost 12. Null for users who have not set a password (invited, Google-only). */
    passwordHash: text(),
    emailVerifiedAt: timestamptz(),
    /** AES-256-GCM with `DATA_ENCRYPTION_KEY` (TOTP, Sprint 1b). */
    totpSecretEnc: text(),
    status: text({ enum: USER_STATUSES }).notNull().default('active'),
    /** Consecutive failed logins since the last success or lockout. */
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamptz(),
    lastLoginAt: timestamptz(),
    ...timestamps(),
  },
  (t) => [
    check('users_email_normalised', sql`${t.email}::text = lower(btrim(${t.email}::text))`),
    check('users_mobile_format', sql`${t.mobile} ~ '^\\+91[6-9][0-9]{9}$'`),
    check('users_full_name_length', lengthBetween(t.fullName, 1, 120)),
    check('users_password_hash_bcrypt', sql`${t.passwordHash} ~ '^\\$2[aby]\\$[0-9]{2}\\$'`),
    check('users_status_valid', inList(t.status, USER_STATUSES)),
    check('users_failed_login_count_non_negative', sql`${t.failedLoginCount} >= 0`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
