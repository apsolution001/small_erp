import { type Permission } from '@ekaro/contracts';
import { Controller, type ExecutionContext, Get, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type ClsService } from 'nestjs-cls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Authenticated } from '../../common/decorators/authenticated.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ForbiddenError, UnauthorizedError } from '../../common/errors/domain-error.js';
import { type Principal, type RequestContext } from '../../infra/tenancy/request-context.js';
import { PermissionGuard } from './permission.guard.js';

@Controller('probe')
class ProbeController {
  @Get('open')
  // Justification (test fixture): public route.
  @Public()
  open(): string {
    return 'open';
  }

  @Get('me')
  // Justification (test fixture): session-only route.
  @Authenticated()
  me(): string {
    return 'me';
  }

  @Get('view')
  @RequirePermission('masters.item:view')
  view(): string {
    return 'view';
  }

  @Get('both')
  @RequirePermission('masters.item:view', 'masters.item:edit')
  both(): string {
    return 'both';
  }

  @Get('bare')
  bare(): string {
    return 'bare';
  }
}

const principal = (permissions: Permission[]): Principal => ({
  userId: 'u',
  tenantId: 't',
  membershipId: 'm',
  sessionId: 's',
  roleId: 'r',
  roleName: 'Sales',
  isOwner: false,
  permissions: new Set(permissions),
  allBranches: true,
  branchIds: [],
});

function contextFor(name: keyof ProbeController, type = 'http'): ExecutionContext {
  const handler: unknown = Reflect.get(ProbeController.prototype, name);
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => ProbeController,
  } as unknown as ExecutionContext;
}

function guardWith(current: Principal | undefined): PermissionGuard {
  const cls = {
    isActive: () => true,
    get: (key: keyof RequestContext) => (key === 'principal' ? current : undefined),
  } as unknown as ClsService<RequestContext>;
  return new PermissionGuard(new Reflector(), cls);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PermissionGuard', () => {
  it('lets public routes through without a session', () => {
    expect(guardWith(undefined).canActivate(contextFor('open'))).toBe(true);
  });

  it('refuses every other route without a session (401)', () => {
    for (const route of ['me', 'view', 'bare'] as const) {
      expect(() => guardWith(undefined).canActivate(contextFor(route))).toThrow(UnauthorizedError);
    }
  });

  it('lets any session through an @Authenticated() route', () => {
    expect(guardWith(principal([])).canActivate(contextFor('me'))).toBe(true);
  });

  it('allows a route when the principal holds every required permission', () => {
    const guard = guardWith(principal(['masters.item:view', 'masters.item:edit']));
    expect(guard.canActivate(contextFor('view'))).toBe(true);
    expect(guard.canActivate(contextFor('both'))).toBe(true);
  });

  it('denies with 403 FORBIDDEN naming the first missing permission', () => {
    const guard = guardWith(principal(['masters.item:view']));
    expect(() => guard.canActivate(contextFor('both'))).toThrow(
      new ForbiddenError('FORBIDDEN', 'You need the masters.item:edit permission.'),
    );
  });

  it('denies a route that declares no permission, even for the owner, and logs it', () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const everything = principal(['masters.item:view', 'masters.item:edit']);
    expect(() => guardWith(everything).canActivate(contextFor('bare'))).toThrow(ForbiddenError);
    expect(logError).toHaveBeenCalledWith(
      { route: 'ProbeController.bare' },
      'Route declares no permission; denied by default',
    );
  });

  it('denies non-HTTP contexts, even for a public handler', () => {
    expect(guardWith(undefined).canActivate(contextFor('bare', 'rpc'))).toBe(false);
    expect(guardWith(undefined).canActivate(contextFor('open', 'ws'))).toBe(false);
  });
});
