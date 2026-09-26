import { uuidv7 } from '@ekaro/core';
import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column builders shared by platform and tenant tables. Kept apart from `columns.ts`
 * (which references `tenants`) so the tenants schema can use them without an import cycle.
 */

/** `id uuid primary key`, a UUIDv7 generated in the app (ADR 0004). */
export const primaryId = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/** `updated_at`, re-stamped with the DB clock on every Drizzle update. */
export const updatedAt = () =>
  timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`);

/** `created_at` / `updated_at`. */
export const timestamps = () => ({
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: updatedAt(),
});
