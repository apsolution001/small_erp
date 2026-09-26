import {
  DEFAULT_ROLES,
  PERMISSIONS,
  paginated,
  problemSchema,
  type RoleResponse,
  roleResponseSchema,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Member, memberWithRole, roleNamed } from '../support/access.js';
import { createTestApp, http } from '../support/app.js';
import { bearer, me, type SignedUp, signUp } from '../support/auth.js';

const rolePage = paginated(roleResponseSchema);

describe('roles (spec 01 §3.3)', () => {
  let app: NestExpressApplication;
  let a: SignedUp;
  let b: SignedUp;
  let admin: Member;
  let sales: Member;

  const owner = () => a.body.accessToken;

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([signUp(app), signUp(app)]);
    admin = await memberWithRole(app, a.body.tenant.id, 'Admin');
    sales = await memberWithRole(app, a.body.tenant.id, 'Sales');
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: 'post' | 'patch' | 'delete', path: string, token: string, body?: object) =>
    http(app)[method](`/api/v1${path}`).set('Authorization', bearer(token)).send(body);
  const get = (path: string, token: string) =>
    http(app).get(`/api/v1${path}`).set('Authorization', bearer(token));
  const problem = (body: unknown) => problemSchema.parse(body);
  const create = async (name: string, permissions: string[] = ['masters.item:view']) =>
    roleResponseSchema.parse(
      (await send('post', '/roles', owner(), { name, permissions }).expect(201)).body,
    );

  describe('GET /roles', () => {
    it('lists the nine system roles by name, with effective permissions', async () => {
      const page = rolePage.parse((await get('/roles?pageSize=50', owner()).expect(200)).body);
      expect(page.meta).toEqual({ page: 1, pageSize: 50, total: 9 });
      expect(page.data.map((r) => r.name)).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());
      const ownerRole = page.data.find((r) => r.isOwner);
      expect(ownerRole).toMatchObject({
        name: 'Owner',
        isSystem: true,
        isBillable: true,
        permissions: [...PERMISSIONS],
      });
      expect(page.data.filter((r) => r.isOwner)).toHaveLength(1);
      expect(page.data.find((r) => r.name === 'CA')).toMatchObject({
        isBillable: false,
        isOwner: false,
      });
    });

    it('searches and pages', async () => {
      const found = rolePage.parse((await get('/roles?q=acc', owner()).expect(200)).body);
      expect(found.data.map((r) => r.name)).toEqual(['Accountant']);
      const paged = rolePage.parse(
        (await get('/roles?pageSize=2&page=2&sort=name:desc', owner()).expect(200)).body,
      );
      expect(paged.data.map((r) => r.name)).toEqual(['Sales', 'Purchase']);
    });

    it('needs access.role:view', async () => {
      await get('/roles', admin.token).expect(200);
      const res = await get('/roles', sales.token).expect(403);
      expect(problem(res.body).detail).toBe('You need the access.role:view permission.');
      const one = await roleNamed(app, owner(), 'Sales');
      await get(`/roles/${one.id}`, admin.token).expect(200);
      await get(`/roles/${one.id}`, sales.token).expect(403);
    });

    it("never shows another tenant's roles (404 by id)", async () => {
      const aSales = await roleNamed(app, owner(), 'Sales');
      expect(
        problem((await get(`/roles/${aSales.id}`, b.body.accessToken).expect(404)).body).code,
      ).toBe('NOT_FOUND');
      const bPage = rolePage.parse(
        (await get('/roles?pageSize=50', b.body.accessToken).expect(200)).body,
      );
      expect(bPage.data.map((r) => r.id)).not.toContain(aSales.id);
    });
  });

  describe('POST /roles', () => {
    it('creates a custom role (201)', async () => {
      const res = await send('post', '/roles', owner(), {
        name: ' Dispatch ',
        description: 'Dispatch desk',
        permissions: ['masters.item:view', 'masters.party:view'],
      }).expect(201);
      expect(roleResponseSchema.parse(res.body)).toMatchObject({
        name: 'Dispatch',
        description: 'Dispatch desk',
        permissions: ['masters.item:view', 'masters.party:view'],
        isSystem: false,
        isOwner: false,
        isBillable: true,
        version: 1,
      });
    });

    it('refuses a duplicate name in any case (409 ALREADY_EXISTS)', async () => {
      const res = await send('post', '/roles', owner(), { name: 'sales' }).expect(409);
      expect(problem(res.body)).toMatchObject({
        code: 'ALREADY_EXISTS',
        detail: 'A role named "sales" already exists.',
      });
      // Another tenant may use the name.
      await send('post', '/roles', b.body.accessToken, { name: 'Dispatch' }).expect(201);
    });

    it('refuses a free role that can write, unknown permissions and unknown keys (422)', async () => {
      const free = await send('post', '/roles', owner(), {
        name: 'Free clerk',
        isBillable: false,
        permissions: ['masters.item:view', 'masters.item:edit'],
      }).expect(422);
      expect(problem(free.body).errors?.[0]?.path).toBe('permissions');
      await send('post', '/roles', owner(), {
        name: 'X',
        permissions: ['masters.item:fly'],
      }).expect(422);
      await send('post', '/roles', owner(), { name: 'X', isSystem: true }).expect(422);
      await send('post', '/roles', owner(), {
        name: 'Auditor',
        isBillable: false,
        permissions: ['audit.log:view', 'masters.party:export'],
      }).expect(201);
    });

    it('nobody grants permissions they lack (403 PERMISSION_NOT_HELD)', async () => {
      const res = await send('post', '/roles', admin.token, {
        name: 'Billing desk',
        permissions: ['platform.billing:view'],
      }).expect(403);
      expect(problem(res.body).code).toBe('PERMISSION_NOT_HELD');
      await send('post', '/roles', admin.token, {
        name: 'Admin made',
        permissions: ['masters.item:view'],
      }).expect(201);
    });

    it('needs access.role:create', async () => {
      const res = await send('post', '/roles', sales.token, { name: 'Nope' }).expect(403);
      expect(problem(res.body).detail).toBe('You need the access.role:create permission.');
    });
  });

  describe('PATCH /roles/:id', () => {
    it('edits with optimistic locking (200, then 409 VERSION_CONFLICT on a stale version)', async () => {
      const role = await create(`Packers ${crypto.randomUUID().slice(0, 8)}`);
      const updated = roleResponseSchema.parse(
        (
          await send('patch', `/roles/${role.id}`, owner(), {
            description: 'Packing',
            permissions: ['masters.item:view', 'masters.unit:view'],
            version: 1,
          }).expect(200)
        ).body,
      );
      expect(updated).toMatchObject({
        description: 'Packing',
        permissions: ['masters.unit:view', 'masters.item:view'],
        version: 2,
      });
      const stale = await send('patch', `/roles/${role.id}`, owner(), {
        name: 'Late',
        version: 1,
      }).expect(409);
      expect(problem(stale.body).code).toBe('VERSION_CONFLICT');
    });

    it('validates the merged record: a free role cannot gain a write permission (422)', async () => {
      const viewer = await roleNamed(app, owner(), 'Viewer');
      const res = await send('patch', `/roles/${viewer.id}`, owner(), {
        permissions: [...viewer.permissions, 'masters.item:edit'],
        version: viewer.version,
      }).expect(422);
      expect(problem(res.body).errors?.[0]?.path).toBe('permissions');
    });

    it('applies to signed-in holders at once (the tenant cache is dropped after commit)', async () => {
      const role = await create(`Checkers ${crypto.randomUUID().slice(0, 8)}`, [
        'masters.unit:view',
      ]);
      const holder = await memberWithRole(app, a.body.tenant.id, role.name);
      expect((await me(app, holder.token)).permissions).toEqual(['masters.unit:view']);
      await send('patch', `/roles/${role.id}`, owner(), {
        name: `${role.name} 2`,
        permissions: ['masters.unit:view', 'masters.godown:view'],
        version: 1,
      }).expect(200);
      const session = await me(app, holder.token);
      expect(session.permissions).toEqual(['masters.godown:view', 'masters.unit:view']);
      expect(session.membership.role.name).toBe(`${role.name} 2`);
    });

    it("the Owner role's permissions and billing never change (422 SYSTEM_ROLE_IMMUTABLE)", async () => {
      const ownerRole = await roleNamed(app, owner(), 'Owner');
      for (const change of [
        { permissions: ['masters.item:view'] },
        { isBillable: false, permissions: ['masters.item:view'] },
      ]) {
        const res = await send('patch', `/roles/${ownerRole.id}`, owner(), {
          ...change,
          version: ownerRole.version,
        }).expect(422);
        expect(problem(res.body).code).toBe('SYSTEM_ROLE_IMMUTABLE');
      }
      const billing = await send('patch', `/roles/${ownerRole.id}`, owner(), {
        isBillable: false,
        version: ownerRole.version,
      }).expect(422);
      expect(problem(billing.body)).toMatchObject({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        detail: 'The Owner role is always billable.',
      });
    });

    it('the Owner may rename the Owner role; an Admin may not touch it (403)', async () => {
      const ownerRole = await roleNamed(app, owner(), 'Owner');
      const denied = await send('patch', `/roles/${ownerRole.id}`, admin.token, {
        description: 'Boss',
        version: ownerRole.version,
      }).expect(403);
      expect(problem(denied.body).code).toBe('OWNER_ASSIGNMENT_FORBIDDEN');
      const renamed = roleResponseSchema.parse(
        (
          await send('patch', `/roles/${ownerRole.id}`, owner(), {
            name: 'Maalik',
            permissions: [...PERMISSIONS].reverse(),
            version: ownerRole.version,
          }).expect(200)
        ).body,
      );
      expect(renamed).toMatchObject({
        name: 'Maalik',
        isOwner: true,
        permissions: [...PERMISSIONS],
      });
      expect((await me(app, owner())).membership.role.name).toBe('Maalik');
      await send('patch', `/roles/${ownerRole.id}`, owner(), {
        name: 'Owner',
        version: renamed.version,
      }).expect(200);
    });

    it('an Admin cannot add a permission it lacks to a role (403 PERMISSION_NOT_HELD)', async () => {
      const salesRole = await roleNamed(app, owner(), 'Sales');
      const res = await send('patch', `/roles/${salesRole.id}`, admin.token, {
        permissions: [...salesRole.permissions, 'platform.billing:view'],
        version: salesRole.version,
      }).expect(403);
      expect(problem(res.body).code).toBe('PERMISSION_NOT_HELD');
    });

    it('needs access.role:edit, and is 404 across tenants', async () => {
      const role = await create(`Edits ${crypto.randomUUID().slice(0, 8)}`);
      const res = await send('patch', `/roles/${role.id}`, sales.token, {
        name: 'x',
        version: 1,
      }).expect(403);
      expect(problem(res.body).detail).toBe('You need the access.role:edit permission.');
      await send('patch', `/roles/${role.id}`, b.body.accessToken, {
        name: 'x',
        version: 1,
      }).expect(404);
    });
  });

  describe('DELETE /roles/:id', () => {
    it('refuses system roles (422 SYSTEM_ROLE_IMMUTABLE)', async () => {
      const viewer = await roleNamed(app, owner(), 'Viewer');
      const res = await send('delete', `/roles/${viewer.id}`, owner()).expect(422);
      expect(problem(res.body)).toMatchObject({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        detail: 'System roles cannot be deleted. Clone one to make a variant.',
      });
    });

    it('refuses a role a user holds (409 ROLE_IN_USE)', async () => {
      const role = await create(`Held ${crypto.randomUUID().slice(0, 8)}`);
      await memberWithRole(app, a.body.tenant.id, role.name);
      const res = await send('delete', `/roles/${role.id}`, owner()).expect(409);
      expect(problem(res.body).code).toBe('ROLE_IN_USE');
    });

    it('refuses a role an open invitation holds; once revoked, deletes it (204)', async () => {
      const role = await create(`Invited ${crypto.randomUUID().slice(0, 8)}`);
      const invitation = await send('post', '/users', owner(), {
        email: `role-${crypto.randomUUID()}@example.com`,
        roleId: role.id,
      }).expect(201);
      const invitationId = (invitation.body as { id: string }).id;
      expect(
        problem((await send('delete', `/roles/${role.id}`, owner()).expect(409)).body).code,
      ).toBe('ROLE_IN_USE');
      await send('delete', `/invitations/${invitationId}`, owner()).expect(204);
      await send('delete', `/roles/${role.id}`, owner()).expect(204);
      await get(`/roles/${role.id}`, owner()).expect(404);
      // The closed invitation keeps its history without the role.
      const list = await get(`/invitations?status=revoked&pageSize=200`, owner()).expect(200);
      const closed = (list.body as { data: { id: string; role: unknown }[] }).data.find(
        (i) => i.id === invitationId,
      );
      expect(closed?.role).toBeNull();
    });

    it('deletes an unused custom role (204); refuses one beyond the actor (403); needs :delete', async () => {
      const role = await create(`Spare ${crypto.randomUUID().slice(0, 8)}`);
      const denied = await send('delete', `/roles/${role.id}`, sales.token).expect(403);
      expect(problem(denied.body).detail).toBe('You need the access.role:delete permission.');
      await send('delete', `/roles/${role.id}`, b.body.accessToken).expect(404);
      await send('delete', `/roles/${role.id}`, admin.token).expect(204);
      const billing = await create(`Bill ${crypto.randomUUID().slice(0, 8)}`, [
        'platform.billing:view',
      ]);
      expect(
        problem((await send('delete', `/roles/${billing.id}`, admin.token).expect(403)).body).code,
      ).toBe('PERMISSION_NOT_HELD');
    });
  });

  describe('POST /roles/:id/clone', () => {
    it('clones a system role into an editable one with the same permissions (201)', async () => {
      const salesRole = await roleNamed(app, owner(), 'Sales');
      const clone = roleResponseSchema.parse(
        (
          await send('post', `/roles/${salesRole.id}/clone`, owner(), {
            name: 'Sales (North)',
          }).expect(201)
        ).body,
      );
      expect(clone).toMatchObject({
        name: 'Sales (North)',
        description: salesRole.description,
        permissions: salesRole.permissions,
        isSystem: false,
        isOwner: false,
        isBillable: true,
      } satisfies Partial<RoleResponse>);
      expect(clone.id).not.toBe(salesRole.id);
      await send('delete', `/roles/${clone.id}`, owner()).expect(204);
    });

    it('the Owner can clone the Owner role into an ordinary role with every permission', async () => {
      const ownerRole = await roleNamed(app, owner(), 'Owner');
      const clone = roleResponseSchema.parse(
        (
          await send('post', `/roles/${ownerRole.id}/clone`, owner(), { name: 'Co-owner' }).expect(
            201,
          )
        ).body,
      );
      expect(clone).toMatchObject({
        isOwner: false,
        isSystem: false,
        permissions: [...PERMISSIONS],
      });
    });

    it('refuses a clone beyond the actor (403), a taken name (409), and needs :create', async () => {
      const ownerRole = await roleNamed(app, owner(), 'Owner');
      expect(
        problem(
          (
            await send('post', `/roles/${ownerRole.id}/clone`, admin.token, {
              name: 'Mine',
            }).expect(403)
          ).body,
        ).code,
      ).toBe('PERMISSION_NOT_HELD');
      const viewer = await roleNamed(app, owner(), 'Viewer');
      expect(
        problem(
          (
            await send('post', `/roles/${viewer.id}/clone`, owner(), { name: 'accountant' }).expect(
              409,
            )
          ).body,
        ).code,
      ).toBe('ALREADY_EXISTS');
      await send('post', `/roles/${viewer.id}/clone`, admin.token, { name: 'Viewer 2' }).expect(
        201,
      );
      const res = await send('post', `/roles/${viewer.id}/clone`, sales.token, {
        name: 'V3',
      }).expect(403);
      expect(problem(res.body).detail).toBe('You need the access.role:create permission.');
      await send('post', `/roles/${viewer.id}/clone`, b.body.accessToken, { name: 'V4' }).expect(
        404,
      );
    });
  });
});
