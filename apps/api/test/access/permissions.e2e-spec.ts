import {
  DEFAULT_ROLES,
  effectivePermissions,
  PERMISSIONS,
  type Permission,
  problemSchema,
} from '@ekaro/contracts';
import { Controller, Get, Module, type Type } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAuthenticatedOnlyRoute } from '../../src/common/decorators/authenticated.decorator.js';
import { isPublicRoute } from '../../src/common/decorators/public.decorator.js';
import {
  RequirePermission,
  requiredPermissions,
} from '../../src/common/decorators/require-permission.decorator.js';
import { addMembership, createTestUser } from '../factories/users.js';
import { createTestApp, http } from '../support/app.js';
import { bearer, logIn, me, signUp } from '../support/auth.js';

/** One probe route per catalogue permission: `GET /api/v1/probe/<module.resource>/<action>`. */
@Controller('probe')
class PermissionProbeController {
  /** Declares nothing: must be refused to everyone (deny by default). */
  @Get('undeclared')
  undeclared(): string {
    return 'reachable';
  }
}

const probePath = (permission: Permission): string => permission.replace(':', '/');

for (const permission of PERMISSIONS) {
  const name = `probe_${permission.replace(/[.:]/g, '_')}`;
  Object.defineProperty(PermissionProbeController.prototype, name, {
    value: () => ({ permission }),
    configurable: true,
    writable: true,
  });
  const descriptor = Object.getOwnPropertyDescriptor(PermissionProbeController.prototype, name);
  if (descriptor === undefined) throw new Error(name);
  Get(probePath(permission))(PermissionProbeController.prototype, name, descriptor);
  RequirePermission(permission)(PermissionProbeController.prototype, name, descriptor);
}

@Module({ controllers: [PermissionProbeController] })
class PermissionProbeModule {}

const ROLE_NAMES = DEFAULT_ROLES.map((r) => r.name);

describe('role × permission matrix (spec 01 §2, deny by default)', () => {
  let app: NestExpressApplication;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    app = await createTestApp({ imports: [PermissionProbeModule] });
    const owner = await signUp(app);
    tokens.set('Owner', owner.body.accessToken);
    for (const role of ROLE_NAMES.filter((r) => r !== 'Owner')) {
      const user = await createTestUser({ fullName: `${role} User` });
      await addMembership(owner.body.tenant.id, user.id, role);
      tokens.set(role, (await logIn(app, user.email)).body.accessToken);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenOf = (role: string): string => {
    const token = tokens.get(role);
    if (token === undefined) throw new Error(role);
    return token;
  };

  it.each(DEFAULT_ROLES.map((r) => [r.name, r] as const))(
    '%s gets exactly its default permissions in /auth/me',
    async (name, role) => {
      const session = await me(app, tokenOf(name));
      expect(session.membership.role.name).toBe(name);
      expect(session.permissions).toEqual(
        effectivePermissions({
          isOwner: role.allPermissions,
          permissions: role.allPermissions ? [] : role.permissions,
        }),
      );
    },
  );

  it.each(ROLE_NAMES)('%s is allowed exactly its permissions on the probe routes', async (name) => {
    const granted = new Set(DEFAULT_ROLES.find((r) => r.name === name)?.permissions);
    const outcomes = await Promise.all(
      PERMISSIONS.map(async (permission) => {
        const res = await http(app)
          .get(`/api/v1/probe/${probePath(permission)}`)
          .set('Authorization', bearer(tokenOf(name)));
        if (res.status === 403) {
          expect(problemSchema.parse(res.body)).toMatchObject({
            code: 'FORBIDDEN',
            detail: `You need the ${permission} permission.`,
          });
        }
        return [permission, res.status] as const;
      }),
    );
    expect(Object.fromEntries(outcomes)).toEqual(
      Object.fromEntries(PERMISSIONS.map((p) => [p, granted.has(p) ? 200 : 403])),
    );
  });

  it('refuses a route that declares no permission, even to the Owner', async () => {
    const res = await http(app)
      .get('/api/v1/probe/undeclared')
      .set('Authorization', bearer(tokenOf('Owner')))
      .expect(403);
    expect(problemSchema.parse(res.body).code).toBe('FORBIDDEN');
  });

  it('refuses every probe without a session (401)', async () => {
    const res = await http(app)
      .get(`/api/v1/probe/${probePath('masters.item:view')}`)
      .expect(401);
    expect(problemSchema.parse(res.body).code).toBe('UNAUTHENTICATED');
  });
});

describe('route access declarations of the real app', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Every HTTP handler of every controller, with how it declares access. */
  function routes(): { route: string; access: string }[] {
    const reflector = new Reflector();
    const found: { route: string; access: string }[] = [];
    for (const moduleRef of app.get(ModulesContainer).values()) {
      for (const wrapper of moduleRef.controllers.values()) {
        const controller = wrapper.metatype as Type;
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (typeof handler !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          const access = isPublicRoute(reflector, handler, controller)
            ? 'public'
            : isAuthenticatedOnlyRoute(reflector, handler, controller)
              ? 'authenticated'
              : (requiredPermissions(reflector, handler, controller)?.join(',') ?? 'NONE');
          found.push({ route: `${controller.name}.${name}`, access });
        }
      }
    }
    return found.sort((a, b) => a.route.localeCompare(b.route));
  }

  it('declares access on every route, and only the known routes are public', () => {
    const all = routes();
    expect(all.filter((r) => r.access === 'NONE')).toEqual([]);
    expect(all.filter((r) => r.access !== 'NONE' && !r.access.includes('.'))).toEqual([
      { route: 'AuthController.login', access: 'public' },
      { route: 'AuthController.logout', access: 'public' },
      { route: 'AuthController.me', access: 'authenticated' },
      { route: 'AuthController.refresh', access: 'public' },
      { route: 'AuthController.selectTenant', access: 'public' },
      { route: 'AuthController.signup', access: 'public' },
      { route: 'AuthController.switchTenant', access: 'authenticated' },
      { route: 'GstinController.lookup', access: 'public' },
      { route: 'HealthController.check', access: 'public' },
    ]);
  });
});
