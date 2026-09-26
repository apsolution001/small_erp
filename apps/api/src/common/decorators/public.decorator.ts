import {
  type CustomDecorator,
  type ExecutionContext,
  SetMetadata,
  type Type,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

export const IS_PUBLIC_KEY = 'ekaro:isPublic';

/** A route handler, as `ExecutionContext#getHandler()` returns it. */
export type RouteHandler = ReturnType<ExecutionContext['getHandler']>;

/**
 * Opts a route out of authentication (the global JWT guard lands in T-104). Allowed only for
 * signup, login, refresh, health and similar, and every use needs a justification comment.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** True when the handler or its controller is marked `@Public()`. */
export function isPublicRoute(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [handler, controller]) === true
  );
}
