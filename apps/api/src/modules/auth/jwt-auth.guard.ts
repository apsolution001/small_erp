import { type CanActivate, type ExecutionContext, Injectable, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { isPublicRoute } from '../../common/decorators/public.decorator.js';
import { UnauthorizedError } from '../../common/errors/domain-error.js';
import { type RequestContext } from '../../infra/tenancy/request-context.js';
import { SessionAccessLoader } from './sessions/session-access.loader.js';
import { assertUsableSession } from './sessions/session-rules.js';
import { AccessTokenService } from './tokens/access-token.service.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/;

/**
 * Global authentication (ADR 0006), before `PermissionGuard`. Verifies the Bearer access token,
 * loads the membership it names (role, permissions, branch scope; cached 60 seconds), refuses
 * disabled users and memberships and inactive tenants, and puts the principal in the request
 * context. The tenant id set here is what `TenantTxInterceptor` scopes the transaction to: it
 * comes from the verified token only, never from request input.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
    private readonly tokens: AccessTokenService,
    private readonly access: SessionAccessLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const controller: Type = context.getClass();
    if (isPublicRoute(this.reflector, context.getHandler(), controller)) return true;

    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    const token = header === undefined ? undefined : BEARER.exec(header)?.[1];
    if (token === undefined) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    const claims = await this.tokens.verifyAccess(token);
    const access = assertUsableSession(
      await this.access.cached(claims.tenantId, claims.membershipId),
      claims,
    );

    this.cls.set('tenantId', access.tenantId);
    this.cls.set('userId', access.userId);
    this.cls.set('membershipId', access.membershipId);
    this.cls.set('principal', {
      userId: access.userId,
      tenantId: access.tenantId,
      membershipId: access.membershipId,
      sessionId: claims.sessionId,
      roleId: access.role.id,
      roleName: access.role.name,
      isOwner: access.role.isOwner,
      permissions: new Set(access.permissions),
      allBranches: access.allBranches,
      branchIds: access.branchIds,
    });
    return true;
  }
}
