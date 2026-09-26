import { Injectable, type OnModuleInit, type Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { isAuthenticatedOnlyRoute } from '../../common/decorators/authenticated.decorator.js';
import { isPublicRoute, type RouteHandler } from '../../common/decorators/public.decorator.js';
import { requiredPermissions } from '../../common/decorators/require-permission.decorator.js';

/**
 * The access declarations a route resolves to (handler first, then controller). More than one
 * is a contradiction: `PermissionGuard` would silently honour the most permissive, so a route
 * meant to need a permission could end up public.
 */
export function conflictingAccessOf(
  reflector: Reflector,
  handler: RouteHandler,
  controller: Type,
): string[] {
  const declared: string[] = [];
  if (isPublicRoute(reflector, handler, controller)) declared.push('@Public()');
  if (isAuthenticatedOnlyRoute(reflector, handler, controller)) declared.push('@Authenticated()');
  if ((requiredPermissions(reflector, handler, controller) ?? []).length > 0) {
    declared.push('@RequirePermission()');
  }
  return declared.length > 1 ? declared : [];
}

/**
 * Refuses to start the app when any route combines `@Public()`, `@Authenticated()` and
 * `@RequirePermission()` (including a controller-level declaration with a different one on a
 * handler). A route with none of them is still allowed to boot: `PermissionGuard` denies it and
 * the route audit e2e test fails on it.
 */
@Injectable()
export class RouteAccessAudit implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const conflicts: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as Type | null;
      if (controller === null) continue;
      const prototype: object = controller.prototype as object;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler: unknown = Reflect.get(prototype, name);
        if (typeof handler !== 'function') continue;
        if (this.reflector.get<string | undefined>(PATH_METADATA, handler) === undefined) continue;
        const declared = conflictingAccessOf(this.reflector, handler, controller);
        if (declared.length > 0)
          conflicts.push(`${controller.name}.${name}: ${declared.join(' + ')}`);
      }
    }
    if (conflicts.length > 0) {
      throw new Error(
        `Routes with conflicting access declarations (use exactly one):\n  ${conflicts.join('\n  ')}`,
      );
    }
  }
}
