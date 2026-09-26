import { Module } from '@nestjs/common';
import { RedisModule } from '../../infra/redis/redis.module.js';
import { AccessCache } from './access-cache.js';
import { PermissionGuard } from './permission.guard.js';

/**
 * Roles, memberships and authorization (ADR 0007). The role and membership CRUD APIs arrive
 * with T-105; they must call the `AccessCache` invalidation hooks after every change.
 */
@Module({
  imports: [RedisModule],
  providers: [AccessCache, PermissionGuard],
  exports: [AccessCache, PermissionGuard],
})
export class AccessModule {}
