import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  type Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { isAuthenticatedOnlyRoute } from '../../common/decorators/authenticated.decorator.js';
import { isPublicRoute } from '../../common/decorators/public.decorator.js';
import { requiredPermissions } from '../../common/decorators/require-permission.decorator.js';
import { ForbiddenError, UnauthorizedError } from '../../common/errors/domain-error.js';
import { type RequestContext } from '../../infra/tenancy/request-context.js';

/**
 * Global authorization, deny by default (ADR 0007). Runs after `JwtAuthGuard`, which puts the
 * principal in the request context. A route passes when it is `@Public()`, or `@Authenticated()`
 * with a session, or the principal holds every permission its `@RequirePermission()` names. A
 * route with none of these is refused: forgetting the decorator can never open a route.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Deny by default here too: no RPC or WebSocket transport exists yet, and when one arrives it
    // must get its own authorization instead of inheriting an open door.
    if (context.getType() !== 'http') return false;
    const handler = context.getHandler();
    const controller: Type = context.getClass();
    if (isPublicRoute(this.reflector, handler, controller)) return true;

    const principal = this.cls.isActive() ? this.cls.get('principal') : undefined;
    if (principal === undefined) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    if (isAuthenticatedOnlyRoute(this.reflector, handler, controller)) return true;

    const required = requiredPermissions(this.reflector, handler, controller);
    if (required === undefined || required.length === 0) {
      this.logger.error(
        { route: `${controller.name}.${handler.name}` },
        'Route declares no permission; denied by default',
      );
      throw new ForbiddenError('FORBIDDEN', 'You do not have access to this action.');
    }
    const missing = required.find((permission) => !principal.permissions.has(permission));
    if (missing !== undefined) {
      throw new ForbiddenError('FORBIDDEN', `You need the ${missing} permission.`);
    }
    return true;
  }
}
