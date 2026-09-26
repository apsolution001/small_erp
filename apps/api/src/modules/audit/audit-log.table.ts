import { type AuditAction } from '@ekaro/contracts';
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../../infra/db/base-columns.js';

/**
 * Read model of `audit_log` (ADR 0008, ADR 0014). The table is created and partitioned by the
 * T-103 SQL migration and written only by the `audit_row_change()` trigger, so it is deliberately
 * not part of `infra/db/schema.ts`: drizzle-kit must never generate DDL for it.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid().notNull(),
  tenantId: uuid().notNull(),
  tableName: text().notNull(),
  rowId: uuid(),
  action: text().$type<AuditAction>().notNull(),
  oldData: jsonb().$type<Record<string, unknown>>(),
  newData: jsonb().$type<Record<string, unknown>>(),
  changedBy: uuid(),
  changedAt: timestamptz().notNull(),
  requestId: text(),
});
