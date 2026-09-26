import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogRepository } from './audit-log.repository.js';
import { AuditLogService } from './audit-log.service.js';

/** Reading the audit trail (ADR 0008). Writing it is the database trigger's job alone. */
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogRepository, AuditLogService],
})
export class AuditModule {}
