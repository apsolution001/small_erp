import { type Permission } from '@ekaro/contracts';
import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Authenticated, isAuthenticatedOnlyRoute } from './authenticated.decorator.js';
import { IS_PUBLIC_KEY, isPublicRoute, Public, type RouteHandler } from './public.decorator.js';
import {
  REQUIRED_PERMISSIONS_KEY,
  RequirePermission,
  requiredPermissions,
} from './require-permission.decorator.js';

@Controller('probe')
@RequirePermission('masters.item:view')
class ProbeController {
  @Get('open')
  // Justification (test fixture): exercises the public metadata.
  @Public()
  open(): string {
    return 'open';
  }

  @Get('edit')
  @RequirePermission('masters.item:edit', 'masters.item:view')
  edit(): string {
    return 'edit';
  }

  @Get('inherited')
  inherited(): string {
    return 'inherited';
  }

  @Get('me')
  // Justification (test fixture): exercises the authenticated-only metadata.
  @Authenticated()
  me(): string {
    return 'me';
  }
}

const reflector = new Reflector();
const handler = (name: keyof ProbeController): RouteHandler => {
  const fn: unknown = Reflect.get(ProbeController.prototype, name);
  if (typeof fn !== 'function') throw new Error(`no handler ${name}`);
  return fn;
};

describe('@Public()', () => {
  it('marks a handler as public and nothing else', () => {
    expect(reflector.get(IS_PUBLIC_KEY, handler('open'))).toBe(true);
    expect(isPublicRoute(reflector, handler('open'), ProbeController)).toBe(true);
    expect(isPublicRoute(reflector, handler('edit'), ProbeController)).toBe(false);
  });
});

describe('@RequirePermission()', () => {
  it('stores the permissions on the handler', () => {
    expect(reflector.get(REQUIRED_PERMISSIONS_KEY, handler('edit'))).toEqual([
      'masters.item:edit',
      'masters.item:view',
    ]);
  });

  it('resolves handler metadata before class metadata', () => {
    expect(requiredPermissions(reflector, handler('edit'), ProbeController)).toEqual([
      'masters.item:edit',
      'masters.item:view',
    ]);
    expect(requiredPermissions(reflector, handler('inherited'), ProbeController)).toEqual([
      'masters.item:view',
    ]);
  });

  it('rejects a string that is not in the contracts catalogue', () => {
    expect(() => RequirePermission('masters.item' as Permission)).toThrow(
      /Invalid permission "masters.item"/,
    );
    expect(() =>
      RequirePermission('masters.item:view', 'masters.widget:view' as Permission),
    ).toThrow(/Invalid permission "masters.widget:view"/);
  });
});

describe('@Authenticated()', () => {
  it('marks a handler as needing only a session', () => {
    expect(isAuthenticatedOnlyRoute(reflector, handler('me'), ProbeController)).toBe(true);
    expect(isAuthenticatedOnlyRoute(reflector, handler('edit'), ProbeController)).toBe(false);
  });
});
