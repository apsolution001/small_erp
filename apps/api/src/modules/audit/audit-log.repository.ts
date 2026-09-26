import { type AuditAction } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { type AppTransactionalAdapter } from '../../infra/db/app-db.js';
import { tenantUsers } from '../auth/users/tenant-users.view.js';
import { type AuditCursor } from './audit-cursor.js';
import { auditLog } from './audit-log.table.js';

export interface AuditFilter {
  readonly table?: string | undefined;
  readonly rowId?: string | undefined;
  readonly userId?: string | undefined;
  readonly action?: AuditAction | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly after?: AuditCursor | undefined;
}

export interface AuditRow {
  readonly id: string;
  readonly tableName: string;
  readonly rowId: string | null;
  readonly action: AuditAction;
  readonly oldData: Record<string, unknown> | null;
  readonly newData: Record<string, unknown> | null;
  readonly changedBy: string | null;
  readonly changedByName: string | null;
  /** Exact UTC text with microseconds: the response value and the next cursor. */
  readonly changedAt: string;
  readonly requestId: string | null;
}

/** `changed_at` as the database knows it, to the microsecond, in UTC. */
const exactChangedAt = sql<string>`to_char(${auditLog.changedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Reads `audit_log` newest first with keyset pagination on `(changed_at, id)`, served by the
 * `(tenant_id, changed_at desc, id desc)` index; RLS adds the tenant predicate. The acting
 * user's name comes from the tenant user directory (null for a user outside it).
 */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  async page(filter: AuditFilter, limit: number): Promise<AuditRow[]> {
    return this.txHost.tx
      .select({
        id: auditLog.id,
        tableName: auditLog.tableName,
        rowId: auditLog.rowId,
        action: auditLog.action,
        oldData: auditLog.oldData,
        newData: auditLog.newData,
        changedBy: auditLog.changedBy,
        changedByName: tenantUsers.fullName,
        changedAt: exactChangedAt,
        requestId: auditLog.requestId,
      })
      .from(auditLog)
      .leftJoin(tenantUsers, eq(tenantUsers.id, auditLog.changedBy))
      .where(
        and(
          filter.table === undefined ? undefined : eq(auditLog.tableName, filter.table),
          filter.rowId === undefined ? undefined : eq(auditLog.rowId, filter.rowId),
          filter.userId === undefined ? undefined : eq(auditLog.changedBy, filter.userId),
          filter.action === undefined ? undefined : eq(auditLog.action, filter.action),
          filter.from === undefined
            ? undefined
            : gte(auditLog.changedAt, sql`${filter.from}::timestamptz`),
          filter.to === undefined
            ? undefined
            : lt(auditLog.changedAt, sql`${filter.to}::timestamptz`),
          filter.after === undefined
            ? undefined
            : sql`(${auditLog.changedAt}, ${auditLog.id}) < (${filter.after.changedAt}::timestamptz, ${filter.after.id}::uuid)`,
        ),
      )
      .orderBy(desc(auditLog.changedAt), desc(auditLog.id))
      .limit(limit);
  }
}
