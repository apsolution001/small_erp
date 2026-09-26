import { type CustomDecorator, SetMetadata, type Type } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type RouteHandler } from './public.decorator.js';

export const IS_AUTHENTICATED_ONLY_KEY = 'ekaro:isAuthenticatedOnly';

/**
 * Needs a valid session but no specific permission: the caller's own session and profile
 * (`/auth/me`, `/auth/switch-tenant`). Tenant data routes use `@RequirePermission()` instead, and
 * every use needs a justification comment, like `@Public()`.
 */
export const Authenticated = (): CustomDecorator => SetMetadata(IS_AUTHENTICATED_ONLY_KEY, true);

/** True when the handler or its controller is marked `@Authenticated()`. */
export function isAuthenticatedOnlyRoute(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_AUTHENTICATED_ONLY_KEY, [
      handler,
      controller,
    ]) === true
  );
}
