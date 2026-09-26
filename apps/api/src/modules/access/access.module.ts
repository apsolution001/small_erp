import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RedisModule } from '../../infra/redis/redis.module.js';
import { AccessCache } from './access-cache.js';
import { PermissionGuard } from './permission.guard.js';
import { RouteAccessAudit } from './route-access.audit.js';

/**
 * Roles, memberships and authorization (ADR 0007). The role and membership CRUD APIs arrive
 * with T-105; they must call the `AccessCache` invalidation hooks after every change.
 */
@Module({
  imports: [RedisModule, DiscoveryModule],
  // RouteAccessAudit refuses to boot an app with a route that declares conflicting access.
  providers: [AccessCache, PermissionGuard, RouteAccessAudit],
  exports: [AccessCache, PermissionGuard],
})
export class AccessModule {}
