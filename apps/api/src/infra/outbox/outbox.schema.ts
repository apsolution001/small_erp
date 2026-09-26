import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from '../db/base-columns.js';
import { inList } from '../db/checks.js';
import { tenantIdColumn } from '../db/columns.js';
import { OUTBOX_TOPICS } from './outbox.messages.js';

/**
 * The transactional outbox (ADR 0011): an external side effect (an email) is recorded in the same
 * transaction as the change that causes it, so it is sent if and only if that change commits. A
 * relay worker (later) publishes unpublished rows to BullMQ, keyed by `id` for idempotency.
 *
 * Tenant-scoped with forced RLS. `ekaro_app` may only INSERT: payloads can carry bearer secrets
 * (an invitation link), so no tenant user can read them back through the API. It is deliberately
 * not audited (T-105 security migration): it is a delivery queue, not business data, and auditing
 * would copy those secrets into `audit_log`. The business change that enqueues it is audited.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: primaryId(),
    tenantId: tenantIdColumn(),
    topic: text({ enum: OUTBOX_TOPICS }).notNull(),
    /** Validated against the topic's schema on write (`outbox.messages.ts`). */
    payload: jsonb().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    createdBy: uuid().default(sql`app_current_user()`),
    requestId: text().default(sql`app_current_request()`),
    /** Set by the relay once the message is on its queue. */
    publishedAt: timestamptz(),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
    index('outbox_tenant_idx').on(t.tenantId),
    check('outbox_topic_valid', inList(t.topic, OUTBOX_TOPICS)),
    check('outbox_attempts_non_negative', sql`${t.attempts} >= 0`),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
