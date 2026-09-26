import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { OutboxModule } from '../../infra/outbox/outbox.module.js';
import { RedisModule } from '../../infra/redis/redis.module.js';
import { AccessCache } from './access-cache.js';
import { InvitationsController } from './invitations/invitations.controller.js';
import { InvitationsRepository } from './invitations/invitations.repository.js';
import { InvitationsService } from './invitations/invitations.service.js';
import { PermissionGuard } from './permission.guard.js';
import { RolesController } from './roles/roles.controller.js';
import { RolesRepository } from './roles/roles.repository.js';
import { RolesService } from './roles/roles.service.js';
import { RouteAccessAudit } from './route-access.audit.js';
import { UsersController } from './users/users.controller.js';
import { UsersRepository } from './users/users.repository.js';
import { UsersService } from './users/users.service.js';

/**
 * Roles, memberships (tenant users), invitations and authorization (ADR 0007, spec 01 §3.3).
 * Every role, membership, branch-scope or status change drops the `AccessCache` after commit.
 */
@Module({
  imports: [RedisModule, DiscoveryModule, OutboxModule],
  controllers: [UsersController, InvitationsController, RolesController],
  providers: [
    AccessCache,
    PermissionGuard,
    // RouteAccessAudit refuses to boot an app with a route that declares conflicting access.
    RouteAccessAudit,
    RolesRepository,
    RolesService,
    UsersRepository,
    UsersService,
    InvitationsRepository,
    InvitationsService,
  ],
  exports: [AccessCache, PermissionGuard],
})
export class AccessModule {}
