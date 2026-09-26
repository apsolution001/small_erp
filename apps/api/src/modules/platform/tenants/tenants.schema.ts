import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from '../../../infra/db/base-columns.js';
import { inList } from '../../../infra/db/checks.js';

/** Tenant lifecycle (spec 01 §1). Mirrored by a Zod enum in `@ekaro/contracts`. */
export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'closed'] as const;
/** Subscription plan (BRD §12); a trial gets growth features. */
export const TENANT_PLANS = ['starter', 'growth', 'pro'] as const;

/**
 * Platform table (no `tenant_id`): read and written through the `ekaro_platform` connection.
 * RLS lets `ekaro_app` see only the row of the current tenant (migration 0002).
 */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    /** URL-safe, derived from the trade name; used in the UI only. */
    slug: text().notNull().unique(),
    status: text({ enum: TENANT_STATUSES }).notNull(),
    plan: text({ enum: TENANT_PLANS }).notNull(),
    trialEndsAt: timestamp({ withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    check(
      'tenants_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 63`,
    ),
    check('tenants_status_valid', inList(t.status, TENANT_STATUSES)),
    check('tenants_plan_valid', inList(t.plan, TENANT_PLANS)),
    check('tenants_trial_has_end', sql`${t.status} <> 'trial' or ${t.trialEndsAt} is not null`),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
