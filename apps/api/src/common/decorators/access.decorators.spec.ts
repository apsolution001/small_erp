import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
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

  it('rejects a permission that is not <module>.<resource>:<action>', () => {
    expect(() => RequirePermission('masters.item' as 'a.b:c')).toThrow(
      /Invalid permission "masters.item"/,
    );
  });
});
