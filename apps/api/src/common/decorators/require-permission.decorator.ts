import { type CustomDecorator, SetMetadata, type Type } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type RouteHandler } from './public.decorator.js';

export const REQUIRED_PERMISSIONS_KEY = 'ekaro:requiredPermissions';

/**
 * `<module>.<resource>:<action>` (ADR 0007). The catalogue and its narrow `Permission` type
 * come from `@ekaro/contracts` (T-102); the guard (T-104) narrows this parameter to it.
 */
export type PermissionString = `${string}.${string}:${string}`;

const PERMISSION_FORMAT = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*:[a-z]+$/;

/**
 * Declares the permissions a route needs (all of them). Metadata only: `PermissionGuard`
 * (T-104) enforces it, deny by default. Method metadata overrides controller metadata.
 */
export function RequirePermission(
  permission: PermissionString,
  ...more: PermissionString[]
): CustomDecorator {
  const permissions = [permission, ...more];
  const invalid = permissions.find((p) => !PERMISSION_FORMAT.test(p));
  if (invalid !== undefined) {
    throw new Error(`Invalid permission "${invalid}": expected <module>.<resource>:<action>`);
  }
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
}

/** The permissions declared on the handler, else on its controller; `undefined` when none. */
export function requiredPermissions(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): readonly PermissionString[] | undefined {
  return reflector.getAllAndOverride<readonly PermissionString[] | undefined>(
    REQUIRED_PERMISSIONS_KEY,
    [handler, controller],
  );
}
