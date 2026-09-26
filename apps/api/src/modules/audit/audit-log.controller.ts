import { type AuditLogPage, type AuditLogQuery, auditLogQuerySchema } from '@ekaro/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuditLogService } from './audit-log.service.js';

/** `GET /api/v1/audit-logs?table=&rowId=&userId=&action=&from=&to=&cursor=&limit=` (spec 01 §3.4). */
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermission('audit.log:view')
  query(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<AuditLogPage> {
    return this.auditLog.query(query);
  }
}
