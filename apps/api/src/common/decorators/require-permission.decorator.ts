import { type Permission, permissionSchema } from '@ekaro/contracts';
import { type CustomDecorator, SetMetadata, type Type } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type RouteHandler } from './public.decorator.js';

export const REQUIRED_PERMISSIONS_KEY = 'ekaro:requiredPermissions';

/**
 * Declares the permissions a route needs (all of them), from the `@ekaro/contracts` catalogue
 * (ADR 0007). Metadata only: the global `PermissionGuard` enforces it, deny by default. Method
 * metadata overrides controller metadata. The runtime check catches strings that were cast.
 */
export function RequirePermission(permission: Permission, ...more: Permission[]): CustomDecorator {
  const permissions = [permission, ...more];
  const invalid = permissions.find((p) => !permissionSchema.safeParse(p).success);
  if (invalid !== undefined) {
    throw new Error(`Invalid permission "${invalid}": not in the @ekaro/contracts catalogue`);
  }
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
}

/** The permissions declared on the handler, else on its controller; `undefined` when none. */
export function requiredPermissions(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): readonly Permission[] | undefined {
  return reflector.getAllAndOverride<readonly Permission[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
    handler,
    controller,
  ]);
}
