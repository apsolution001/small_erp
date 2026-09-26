import { type AuditLogEntry, type AuditLogPage, type AuditLogQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../common/errors/domain-error.js';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';
import { AuditLogRepository, type AuditRow } from './audit-log.repository.js';

/** The tenant's audit trail (spec 01 §3.4, PL-04): newest first, one keyset page at a time. */
@Injectable()
export class AuditLogService {
  constructor(private readonly auditLog: AuditLogRepository) {}

  async query(query: AuditLogQuery): Promise<AuditLogPage> {
    const after = query.cursor === undefined ? undefined : decodeAuditCursor(query.cursor);
    if (query.cursor !== undefined && after === undefined) {
      throw new ValidationError([{ path: 'cursor', message: 'Invalid cursor', code: 'invalid' }]);
    }
    // One extra row tells whether another page follows, without a count.
    const rows = await this.auditLog.page({ ...query, after }, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toEntry),
      meta: {
        limit: query.limit,
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeAuditCursor({ changedAt: last.changedAt, id: last.id })
            : null,
      },
    };
  }
}

function toEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    tableName: row.tableName,
    rowId: row.rowId,
    action: row.action,
    oldData: row.oldData,
    newData: row.newData,
    changedBy: row.changedBy === null ? null : { id: row.changedBy, name: row.changedByName },
    changedAt: row.changedAt,
    requestId: row.requestId,
  };
}
