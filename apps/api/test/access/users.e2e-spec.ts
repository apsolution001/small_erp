import {
  invitationResponseSchema,
  paginated,
  problemSchema,
  type UserResponse,
  userResponseSchema,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser } from '../factories/users.js';
import {
  headOfficeId,
  type Member,
  memberWithRole,
  outboxInvitation,
  roleNamed,
} from '../support/access.js';
import { createTestApp, http } from '../support/app.js';
import { bearer, me, type SignedUp, signUp } from '../support/auth.js';
import { eq } from 'drizzle-orm';
import { tenants } from '../../src/modules/platform/tenants/tenants.schema.js';
import { testPlatformDb, withOwnerClient, withTenantConnection } from '../support/db.js';
import { loadTestEnv } from '../support/test-env.js';

const userPage = paginated(userResponseSchema);

describe('tenant users (spec 01 §3.3)', () => {
  let app: NestExpressApplication;
  let a: SignedUp;
  let b: SignedUp;
  let admin: Member;
  let sales: Member;
  let viewer: Member;

  const owner = () => a.body.accessToken;
  const tenantA = () => a.body.tenant.id;

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([signUp(app, { fullName: 'Asha Mehta' }), signUp(app)]);
    admin = await memberWithRole(app, tenantA(), 'Admin', { fullName: 'Arun Admin' });
    sales = await memberWithRole(app, tenantA(), 'Sales', { fullName: 'Sita Sales' });
    viewer = await memberWithRole(app, tenantA(), 'Viewer', { fullName: 'Vijay Viewer' });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, token: string) =>
    http(app).get(`/api/v1${path}`).set('Authorization', bearer(token));
  const patch = (id: string, token: string, body: object) =>
    http(app).patch(`/api/v1/users/${id}`).set('Authorization', bearer(token)).send(body);
  const current = async (id: string): Promise<UserResponse> =>
    userResponseSchema.parse((await get(`/users/${id}`, owner()).expect(200)).body);
  const problem = (body: unknown) => problemSchema.parse(body);

  describe('GET /users', () => {
    it("lists the tenant's members with name, email, role and branch scope", async () => {
      const res = await get('/users', owner()).expect(200);
      const page = userPage.parse(res.body);
      expect(page.meta).toEqual({ page: 1, pageSize: 25, total: 4 });
      expect(page.data.map((u) => [u.fullName, u.role.name, u.status])).toEqual([
        ['Arun Admin', 'Admin', 'active'],
        ['Asha Mehta', 'Owner', 'active'],
        ['Sita Sales', 'Sales', 'active'],
        ['Vijay Viewer', 'Viewer', 'active'],
      ]);
      const ownerRow = page.data.find((u) => u.userId === a.body.user.id);
      expect(ownerRow).toMatchObject({
        id: a.body.membership.id,
        email: a.email,
        allBranches: true,
        branchIds: [],
        version: 1,
      });
    });

    it('filters by status, role and text, sorts, and pages', async () => {
      const salesRole = await roleNamed(app, owner(), 'Sales');
      const byRole = userPage.parse(
        (await get(`/users?roleId=${salesRole.id}`, owner()).expect(200)).body,
      );
      expect(byRole.data.map((u) => u.fullName)).toEqual(['Sita Sales']);
      const byText = userPage.parse((await get('/users?q=vIjAy', owner()).expect(200)).body);
      expect(byText.data.map((u) => u.fullName)).toEqual(['Vijay Viewer']);
      const byEmail = userPage.parse(
        (await get(`/users?q=${sales.email}`, owner()).expect(200)).body,
      );
      expect(byEmail.data.map((u) => u.userId)).toEqual([sales.userId]);
      const invited = userPage.parse(
        (await get('/users?status=invited', owner()).expect(200)).body,
      );
      expect(invited.meta.total).toBe(0);
      const paged = userPage.parse(
        (await get('/users?sort=fullName:desc&pageSize=2&page=2', owner()).expect(200)).body,
      );
      expect(paged.data.map((u) => u.fullName)).toEqual(['Asha Mehta', 'Arun Admin']);
      expect(paged.meta).toEqual({ page: 2, pageSize: 2, total: 4 });
    });

    it('refuses unknown filters and sorts (422)', async () => {
      expect(
        problem((await get('/users?sort=passwordHash:asc', owner()).expect(422)).body).code,
      ).toBe('VALIDATION_FAILED');
      await get(`/users?tenantId=${b.body.tenant.id}`, owner()).expect(422);
    });

    it("never shows another tenant's users", async () => {
      const page = userPage.parse((await get('/users', b.body.accessToken).expect(200)).body);
      expect(page.data.map((u) => u.userId)).toEqual([b.body.user.id]);
      const res = await get(`/users/${a.body.membership.id}`, b.body.accessToken).expect(404);
      expect(problem(res.body).code).toBe('NOT_FOUND');
      await patch(a.body.membership.id, b.body.accessToken, {
        status: 'disabled',
        version: 1,
      }).expect(404);
    });

    it('needs access.user:view (Admin yes, Sales and Viewer no)', async () => {
      await get('/users', admin.token).expect(200);
      await get(`/users/${sales.membershipId}`, admin.token).expect(200);
      for (const token of [sales.token, viewer.token]) {
        const res = await get('/users', token).expect(403);
        expect(problem(res.body)).toMatchObject({
          code: 'FORBIDDEN',
          detail: 'You need the access.user:view permission.',
        });
        await get(`/users/${admin.membershipId}`, token).expect(403);
      }
      await http(app).get('/api/v1/users').expect(401);
    });
  });

  describe('PATCH /users/:membershipId safety rules', () => {
    it('you cannot change your own role (422 SELF_ROLE_CHANGE), even as the Owner', async () => {
      const salesRole = await roleNamed(app, owner(), 'Sales');
      const self = await current(admin.membershipId);
      const res = await patch(admin.membershipId, admin.token, {
        roleId: salesRole.id,
        version: self.version,
      }).expect(422);
      expect(problem(res.body)).toMatchObject({
        code: 'SELF_ROLE_CHANGE',
        detail: 'You cannot change your own role.',
      });
      const ownSelf = await current(a.body.membership.id);
      const adminRole = await roleNamed(app, owner(), 'Admin');
      expect(
        problem(
          (
            await patch(a.body.membership.id, owner(), {
              roleId: adminRole.id,
              version: ownSelf.version,
            }).expect(422)
          ).body,
        ).code,
      ).toBe('SELF_ROLE_CHANGE');
    });

    it('you cannot disable yourself (422 SELF_DISABLE)', async () => {
      const self = await current(admin.membershipId);
      const res = await patch(admin.membershipId, admin.token, {
        status: 'disabled',
        version: self.version,
      }).expect(422);
      expect(problem(res.body).code).toBe('SELF_DISABLE');
    });

    it('only an Owner assigns the Owner role (403 OWNER_ASSIGNMENT_FORBIDDEN)', async () => {
      const ownerRole = await roleNamed(app, owner(), 'Owner');
      const target = await memberWithRole(app, tenantA(), 'Store');
      const before = await current(target.membershipId);
      const res = await patch(target.membershipId, admin.token, {
        roleId: ownerRole.id,
        version: before.version,
      }).expect(403);
      expect(problem(res.body)).toMatchObject({
        code: 'OWNER_ASSIGNMENT_FORBIDDEN',
        detail: 'Only an Owner can assign or change the Owner role.',
      });
      const done = userResponseSchema.parse(
        (
          await patch(target.membershipId, owner(), {
            roleId: ownerRole.id,
            version: before.version,
          }).expect(200)
        ).body,
      );
      expect(done).toMatchObject({ role: { id: ownerRole.id, name: 'Owner' }, version: 2 });
      // Now an Owner: an Admin may neither demote nor disable them.
      const salesRole = await roleNamed(app, owner(), 'Sales');
      for (const change of [{ roleId: salesRole.id }, { status: 'disabled' }]) {
        const denied = await patch(target.membershipId, admin.token, { ...change, version: 2 });
        expect(denied.status, JSON.stringify(change)).toBe(403);
        expect(problem(denied.body).code).toBe('OWNER_ASSIGNMENT_FORBIDDEN');
      }
    });

    it('never disables or demotes the last active Owner (422 LAST_OWNER)', async () => {
      // A fresh company: the owner plus a second Owner.
      const c = await signUp(app);
      const ownerRole = await roleNamed(app, c.body.accessToken, 'Owner');
      const second = await memberWithRole(app, c.body.tenant.id, 'Owner');
      // The first owner's session still holds the Owner role (cached), but in the database they
      // were just made an Admin, so the second Owner is the last one.
      await withTenantConnection(c.body.tenant.id, (client) =>
        client.query(
          `update memberships set role_id = (select id from roles where name = 'Admin') where id = $1`,
          [c.body.membership.id],
        ),
      );
      const res = await patch(second.membershipId, c.body.accessToken, {
        status: 'disabled',
        version: 1,
      }).expect(422);
      expect(problem(res.body)).toMatchObject({
        code: 'LAST_OWNER',
        detail:
          'The company must keep at least one active Owner. Make someone else an Owner first.',
      });
      const demote = await patch(second.membershipId, c.body.accessToken, {
        roleId: (await roleNamed(app, second.token, 'Viewer')).id,
        version: 1,
      }).expect(422);
      expect(problem(demote.body).code).toBe('LAST_OWNER');
      expect((await current2(c.body.accessToken, second.membershipId)).role.id).toBe(ownerRole.id);
    });

    it('two Owners demoting each other at once never leave the company without one', async () => {
      const c = await signUp(app);
      const second = await memberWithRole(app, c.body.tenant.id, 'Owner');
      const viewerRole = await roleNamed(app, c.body.accessToken, 'Viewer');
      const results = await Promise.all([
        patch(second.membershipId, c.body.accessToken, { roleId: viewerRole.id, version: 1 }),
        patch(c.body.membership.id, second.token, { roleId: viewerRole.id, version: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(
        results.some((r) => r.status === 403) ? [200, 403] : [200, 422],
      );
      const owners = await withTenantConnection(
        c.body.tenant.id,
        async (client) =>
          (
            await client.query<{ n: number }>(
              `select count(*)::int as n from memberships m join roles r on r.id = m.role_id
              where r.is_owner and m.status = 'active'`,
            )
          ).rows,
      );
      expect(owners).toEqual([{ n: 1 }]);
    });

    it('refuses a role with permissions the actor lacks (403 PERMISSION_NOT_HELD)', async () => {
      const billing = await http(app)
        .post('/api/v1/roles')
        .set('Authorization', bearer(owner()))
        .send({ name: 'Billing Clerk', permissions: ['platform.billing:view'] })
        .expect(201);
      const target = await memberWithRole(app, tenantA(), 'Store');
      const res = await patch(target.membershipId, admin.token, {
        roleId: (billing.body as { id: string }).id,
        version: 1,
      }).expect(403);
      expect(problem(res.body)).toMatchObject({
        code: 'PERMISSION_NOT_HELD',
        detail: 'You cannot grant permissions you do not hold: platform.billing:view.',
      });
    });

    it('validates the merged record, the role and the branches (422)', async () => {
      const target = await memberWithRole(app, tenantA(), 'Store');
      const merged = await patch(target.membershipId, owner(), {
        allBranches: false,
        version: 1,
      }).expect(422);
      expect(problem(merged.body).errors).toEqual([
        { path: 'branchIds', message: 'Choose at least one branch', code: 'custom' },
      ]);
      const unknownRole = await patch(target.membershipId, owner(), {
        roleId: crypto.randomUUID(),
        version: 1,
      }).expect(422);
      expect(problem(unknownRole.body).errors).toEqual([
        { path: 'roleId', message: 'Unknown role', code: 'not_found' },
      ]);
      const foreignBranch = await headOfficeId(b.body.tenant.id);
      const branch = await patch(target.membershipId, owner(), {
        allBranches: false,
        branchIds: [foreignBranch],
        version: 1,
      }).expect(422);
      expect(problem(branch.body).errors).toEqual([
        { path: 'branchIds', message: 'Unknown or inactive branch', code: 'not_found' },
      ]);
      const invited = await patch(target.membershipId, owner(), {
        status: 'invited',
        version: 1,
      }).expect(422);
      expect(problem(invited.body).errors?.[0]?.path).toBe('status');
      expect((await current(target.membershipId)).version).toBe(1);
    });

    it('refuses a stale version (409 VERSION_CONFLICT)', async () => {
      const target = await memberWithRole(app, tenantA(), 'Store');
      await patch(target.membershipId, owner(), { status: 'disabled', version: 1 }).expect(200);
      const res = await patch(target.membershipId, owner(), {
        status: 'active',
        version: 1,
      }).expect(409);
      expect(problem(res.body).code).toBe('VERSION_CONFLICT');
    });

    it('needs access.user:edit (Sales and Viewer are refused)', async () => {
      const target = await memberWithRole(app, tenantA(), 'Store');
      for (const token of [sales.token, viewer.token]) {
        const res = await patch(target.membershipId, token, { status: 'disabled', version: 1 });
        expect(res.status).toBe(403);
        expect(problem(res.body).detail).toBe('You need the access.user:edit permission.');
      }
    });
  });

  describe('changes apply from the next request (AccessCache invalidated after commit)', () => {
    it('a role change shows in the member’s /auth/me at once', async () => {
      const target = await memberWithRole(app, tenantA(), 'Viewer');
      expect((await me(app, target.token)).membership.role.name).toBe('Viewer'); // now cached
      const store = await roleNamed(app, owner(), 'Store');
      await patch(target.membershipId, owner(), { roleId: store.id, version: 1 }).expect(200);
      const session = await me(app, target.token);
      expect(session.membership.role).toEqual({ id: store.id, name: 'Store' });
      expect(session.permissions).toEqual(store.permissions);
    });

    it('a branch-scope change shows at once, and is audited against the membership', async () => {
      const target = await memberWithRole(app, tenantA(), 'Store');
      await me(app, target.token);
      const ho = await headOfficeId(tenantA());
      const updated = userResponseSchema.parse(
        (
          await patch(target.membershipId, owner(), {
            allBranches: false,
            branchIds: [ho],
            version: 1,
          }).expect(200)
        ).body,
      );
      expect(updated).toMatchObject({ allBranches: false, branchIds: [ho], version: 2 });
      expect((await me(app, target.token)).membership).toMatchObject({
        allBranches: false,
        branchIds: [ho],
      });
      const audit = await withTenantConnection(
        tenantA(),
        async (c) =>
          (
            await c.query<{
              table_name: string;
              action: string;
              row_id: string;
              changed_by: string;
            }>(
              `select table_name, action, row_id, changed_by from audit_log
              where row_id = $1 and action <> 'INSERT' or (table_name = 'membership_branches' and row_id = $1)
              order by changed_at, table_name`,
              [target.membershipId],
            )
          ).rows,
      );
      expect(audit).toEqual([
        {
          table_name: 'membership_branches',
          action: 'INSERT',
          row_id: target.membershipId,
          changed_by: a.body.user.id,
        },
        {
          table_name: 'memberships',
          action: 'UPDATE',
          row_id: target.membershipId,
          changed_by: a.body.user.id,
        },
      ]);
      // Back to all branches removes the scope rows.
      await patch(target.membershipId, owner(), {
        allBranches: true,
        branchIds: [],
        version: 2,
      }).expect(200);
      expect((await current(target.membershipId)).branchIds).toEqual([]);
    });

    it('a disabled member is refused on the very next request (403 FORBIDDEN)', async () => {
      const target = await memberWithRole(app, tenantA(), 'Viewer');
      await me(app, target.token);
      await patch(target.membershipId, owner(), { status: 'disabled', version: 1 }).expect(200);
      const res = await get('/auth/me', target.token).expect(403);
      expect(problem(res.body).code).toBe('FORBIDDEN');
      const back = userResponseSchema.parse(
        (await patch(target.membershipId, owner(), { status: 'active', version: 2 }).expect(200))
          .body,
      );
      expect(back.joinedAt).not.toBeNull();
      await get('/auth/me', target.token).expect(200);
    });
  });

  describe('invitations: POST /users, GET and DELETE /invitations', () => {
    const invite = (token: string, body: object) =>
      http(app).post('/api/v1/users').set('Authorization', bearer(token)).send(body);

    it('invites by email: a pending invitation plus its email in the outbox', async () => {
      const salesRole = await roleNamed(app, owner(), 'Sales');
      const email = `Invitee.${crypto.randomUUID()}@Example.com `;
      const res = await invite(owner(), { email, roleId: salesRole.id }).expect(201);
      const invitation = invitationResponseSchema.parse(res.body);
      const normalised = email.trim().toLowerCase();
      expect(invitation).toMatchObject({
        email: normalised,
        role: { id: salesRole.id, name: 'Sales' },
        allBranches: true,
        branchIds: [],
        status: 'pending',
        invitedBy: { id: a.body.user.id, name: 'Asha Mehta' },
        acceptedAt: null,
        revokedAt: null,
      });
      const days =
        (Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)) / 86_400_000;
      expect(Math.round(days)).toBe(7);

      const mail = await outboxInvitation(tenantA(), invitation.id);
      expect(mail.payload).toMatchObject({
        to: normalised,
        invitationId: invitation.id,
        roleName: 'Sales',
        invitedByName: 'Asha Mehta',
        expiresAt: invitation.expiresAt,
      });
      expect(mail.payload.companyName).toBe(a.body.tenant.name);
      const link = new URL(mail.payload.acceptUrl);
      expect(link.origin).toBe(new URL(loadTestEnv().APP_ORIGIN).origin);
      expect(link.pathname).toBe('/accept-invitation');
      expect(link.search).toBe('');
      expect(link.hash).toMatch(/^#token=[A-Za-z0-9_-]{43}$/);
      // Only the hash is stored; the audit trail sees the hash, never the token.
      const stored = await withTenantConnection(
        tenantA(),
        async (c) =>
          (
            await c.query<{ token_hash: string; audited: number }>(
              `select token_hash,
                    (select count(*)::int from audit_log where table_name = 'invitations' and row_id = i.id) as audited
               from invitations i where id = $1`,
              [invitation.id],
            )
          ).rows[0],
      );
      expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.token_hash).not.toContain(mail.token);
      expect(stored?.audited).toBe(1);
    });

    it('re-inviting an email replaces the open invitation (the old link stops working)', async () => {
      const store = await roleNamed(app, owner(), 'Store');
      const email = `again-${crypto.randomUUID()}@example.com`;
      const first = invitationResponseSchema.parse(
        (await invite(owner(), { email, roleId: store.id }).expect(201)).body,
      );
      const firstMail = await outboxInvitation(tenantA(), first.id);
      const second = invitationResponseSchema.parse(
        (await invite(owner(), { email, roleId: store.id }).expect(201)).body,
      );
      expect(second.id).not.toBe(first.id);
      const list = paginated(invitationResponseSchema).parse(
        (await get(`/invitations?q=${email}&sort=createdAt:asc`, owner()).expect(200)).body,
      );
      expect(list.data.map((i) => [i.id, i.status])).toEqual([
        [first.id, 'revoked'],
        [second.id, 'pending'],
      ]);
      const res = await http(app)
        .post('/api/v1/auth/invitations/preview')
        .send({ token: firstMail.token })
        .expect(404);
      expect(problem(res.body).code).toBe('INVITATION_INVALID');
    });

    it('refuses an existing member (409), an unknown role or branch (422)', async () => {
      const store = await roleNamed(app, owner(), 'Store');
      const dup = await invite(owner(), {
        email: sales.email.toUpperCase(),
        roleId: store.id,
      }).expect(409);
      expect(problem(dup.body)).toMatchObject({
        code: 'ALREADY_EXISTS',
        detail: `${sales.email} is already a user of this company.`,
      });
      const role = await invite(owner(), {
        email: 'x@example.com',
        roleId: crypto.randomUUID(),
      }).expect(422);
      expect(problem(role.body).errors?.[0]?.path).toBe('roleId');
      const branch = await invite(owner(), {
        email: 'x@example.com',
        roleId: store.id,
        allBranches: false,
        branchIds: [await headOfficeId(b.body.tenant.id)],
      }).expect(422);
      expect(problem(branch.body).errors?.[0]?.path).toBe('branchIds');
      await invite(owner(), {
        email: 'x@example.com',
        roleId: store.id,
        tenantId: tenantA(),
      }).expect(422);
    });

    it('only an Owner invites as Owner; nobody invites beyond their permissions (403)', async () => {
      const ownerRole = await roleNamed(app, owner(), 'Owner');
      const res = await invite(admin.token, {
        email: 'boss@example.com',
        roleId: ownerRole.id,
      }).expect(403);
      expect(problem(res.body).code).toBe('OWNER_ASSIGNMENT_FORBIDDEN');
      const billing = await roleNamed(app, owner(), 'Billing Clerk').catch(async () =>
        http(app)
          .post('/api/v1/roles')
          .set('Authorization', bearer(owner()))
          .send({ name: 'Billing Clerk', permissions: ['platform.billing:view'] })
          .then((r) => r.body as { id: string }),
      );
      const beyond = await invite(admin.token, {
        email: 'bill@example.com',
        roleId: billing.id,
      }).expect(403);
      expect(problem(beyond.body).code).toBe('PERMISSION_NOT_HELD');
      await invite(owner(), {
        email: `boss-${crypto.randomUUID()}@example.com`,
        roleId: ownerRole.id,
      }).expect(201);
    });

    it('needs access.user:create to invite, :view to list and :delete to revoke', async () => {
      const store = await roleNamed(app, owner(), 'Store');
      const created = invitationResponseSchema.parse(
        (
          await invite(admin.token, {
            email: `perm-${crypto.randomUUID()}@example.com`,
            roleId: store.id,
          }).expect(201)
        ).body,
      );
      await get('/invitations', admin.token).expect(200);
      for (const token of [sales.token, viewer.token]) {
        expect(
          problem(
            (await invite(token, { email: 'y@example.com', roleId: store.id }).expect(403)).body,
          ).detail,
        ).toBe('You need the access.user:create permission.');
        await get('/invitations', token).expect(403);
        await http(app)
          .delete(`/api/v1/invitations/${created.id}`)
          .set('Authorization', bearer(token))
          .expect(403);
      }
      await http(app)
        .delete(`/api/v1/invitations/${created.id}`)
        .set('Authorization', bearer(admin.token))
        .expect(204);
    });

    it('revokes an open invitation once (204, then 409); B cannot see or revoke it (404)', async () => {
      const store = await roleNamed(app, owner(), 'Store');
      const created = invitationResponseSchema.parse(
        (
          await invite(owner(), {
            email: `rev-${crypto.randomUUID()}@example.com`,
            roleId: store.id,
          }).expect(201)
        ).body,
      );
      const del = (token: string) =>
        http(app).delete(`/api/v1/invitations/${created.id}`).set('Authorization', bearer(token));
      await del(b.body.accessToken).expect(404);
      const bList = paginated(invitationResponseSchema).parse(
        (await get('/invitations', b.body.accessToken).expect(200)).body,
      );
      expect(bList.data).toEqual([]);
      await del(owner()).expect(204);
      expect(problem((await del(owner()).expect(409)).body).code).toBe('INVALID_TRANSITION');
      await http(app)
        .delete(`/api/v1/invitations/${crypto.randomUUID()}`)
        .set('Authorization', bearer(owner()))
        .expect(404);
    });

    it('lists by status, deriving expired from the expiry', async () => {
      const store = await roleNamed(app, owner(), 'Store');
      const email = `exp-${crypto.randomUUID()}@example.com`;
      const created = invitationResponseSchema.parse(
        (await invite(owner(), { email, roleId: store.id }).expect(201)).body,
      );
      await expireInvitation(tenantA(), created.id);
      const expired = paginated(invitationResponseSchema).parse(
        (await get('/invitations?status=expired', owner()).expect(200)).body,
      );
      expect(expired.data.map((i) => i.id)).toContain(created.id);
      const pending = paginated(invitationResponseSchema).parse(
        (await get('/invitations?status=pending&pageSize=200', owner()).expect(200)).body,
      );
      expect(pending.data.map((i) => i.id)).not.toContain(created.id);
      expect(pending.data.every((i) => i.status === 'pending')).toBe(true);
    });
  });

  describe('accepting an invitation (public)', () => {
    const inviteAs = async (roleName: string, email: string, extra: object = {}) => {
      const role = await roleNamed(app, owner(), roleName);
      const res = await http(app)
        .post('/api/v1/users')
        .set('Authorization', bearer(owner()))
        .send({ email, roleId: role.id, ...extra })
        .expect(201);
      const invitation = invitationResponseSchema.parse(res.body);
      return { invitation, token: (await outboxInvitation(tenantA(), invitation.id)).token };
    };
    const accept = (body: object) => http(app).post('/api/v1/auth/accept-invitation').send(body);
    const preview = (token: string) =>
      http(app).post('/api/v1/auth/invitations/preview').send({ token });

    it('a new email: preview, then accept with a name and password, then sign in', async () => {
      const email = `new-${crypto.randomUUID()}@example.com`;
      const ho = await headOfficeId(tenantA());
      const { token } = await inviteAs('Store', email, { allBranches: false, branchIds: [ho] });
      const shown = await preview(token).expect(200);
      expect(shown.body).toEqual({
        email,
        companyName: a.body.tenant.name,
        roleName: 'Store',
        invitedByName: 'Asha Mehta',
        expiresAt: expect.any(String) as string,
        existingUser: false,
      });

      const missing = await accept({ token }).expect(422);
      expect(problem(missing.body).errors?.map((e) => e.path)).toEqual(['fullName', 'password']);
      const common = await accept({ token, fullName: 'Neha New', password: 'password123' }).expect(
        422,
      );
      expect(problem(common.body).errors).toEqual([
        { path: 'password', message: 'This password is too common', code: 'too_common' },
      ]);
      const res = await accept({
        token,
        fullName: 'Neha New',
        password: 'a long enough passphrase',
      }).expect(200);
      expect(res.body).toEqual({
        email,
        tenant: { id: tenantA(), name: a.body.tenant.name },
        userCreated: true,
      });
      expect(res.headers['set-cookie']).toBeUndefined();

      const login = await http(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'a long enough passphrase' })
        .expect(200);
      const session = await me(app, (login.body as { accessToken: string }).accessToken);
      expect(session).toMatchObject({
        user: { email, fullName: 'Neha New', mobile: null },
        tenant: { id: tenantA() },
        membership: {
          role: { name: 'Store' },
          allBranches: false,
          branchIds: [ho],
          status: 'active',
        },
      });
      const listed = userPage.parse((await get(`/users?q=${email}`, owner()).expect(200)).body);
      expect(listed.data[0]).toMatchObject({ fullName: 'Neha New', status: 'active' });
      expect(listed.data[0]?.joinedAt).not.toBeNull();

      // The membership was written by the accepting user, and the link works only once.
      const audit = await withTenantConnection(
        tenantA(),
        async (c) =>
          (
            await c.query<{ changed_by: string }>(
              `select changed_by from audit_log where table_name = 'memberships' and row_id = $1`,
              [session.membership.id],
            )
          ).rows,
      );
      expect(audit).toEqual([{ changed_by: session.user.id }]);
      expect(problem((await accept({ token }).expect(404)).body).code).toBe('INVITATION_INVALID');
    });

    it('an existing user (another company) accepts with the token alone and keeps their password', async () => {
      const other = b; // B's owner is an existing Ekaro user
      const { token } = await inviteAs('Viewer', other.email);
      expect((await preview(token).expect(200)).body).toMatchObject({ existingUser: true });
      const withPassword = await accept({
        token,
        fullName: 'Someone Else',
        password: 'a different passphrase',
      }).expect(422);
      expect(problem(withPassword.body).errors?.[0]).toMatchObject({
        path: 'password',
        code: 'existing_user',
      });
      expect((await accept({ token }).expect(200)).body).toMatchObject({ userCreated: false });
      // Their original password still works, and they now choose between two companies.
      const login = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: other.email, password: other.password })
        .expect(200);
      expect((login.body as { requiresTenantSelection?: boolean }).requiresTenantSelection).toBe(
        true,
      );
    });

    it('refuses expired (422) and revoked or unknown (404) links', async () => {
      const expired = await inviteAs('Viewer', `late-${crypto.randomUUID()}@example.com`);
      await expireInvitation(tenantA(), expired.invitation.id);
      const late = await accept({ token: expired.token }).expect(422);
      expect(problem(late.body).code).toBe('INVITATION_EXPIRED');
      expect(problem((await preview(expired.token).expect(422)).body).code).toBe(
        'INVITATION_EXPIRED',
      );

      const revoked = await inviteAs('Viewer', `gone-${crypto.randomUUID()}@example.com`);
      await http(app)
        .delete(`/api/v1/invitations/${revoked.invitation.id}`)
        .set('Authorization', bearer(owner()))
        .expect(204);
      expect(problem((await accept({ token: revoked.token }).expect(404)).body).code).toBe(
        'INVITATION_INVALID',
      );
      for (const token of ['x'.repeat(43), 'not-a-token']) {
        expect(problem((await accept({ token }).expect(404)).body).code).toBe('INVITATION_INVALID');
      }
      await accept({ token: 'x', extra: true }).expect(422);
    });

    it('refuses to join a company that is no longer active (403 TENANT_SUSPENDED)', async () => {
      const c = await signUp(app);
      const viewerRole = await roleNamed(app, c.body.accessToken, 'Viewer');
      const created = invitationResponseSchema.parse(
        (
          await http(app)
            .post('/api/v1/users')
            .set('Authorization', bearer(c.body.accessToken))
            .send({ email: `susp-${crypto.randomUUID()}@example.com`, roleId: viewerRole.id })
            .expect(201)
        ).body,
      );
      const { token } = await outboxInvitation(c.body.tenant.id, created.id);
      await testPlatformDb()
        .update(tenants)
        .set({ status: 'suspended' })
        .where(eq(tenants.id, c.body.tenant.id));
      for (const res of [await preview(token), await accept({ token })]) {
        expect(res.status).toBe(403);
        expect(problem(res.body).code).toBe('TENANT_SUSPENDED');
      }
    });

    it('a user who became a member meanwhile gets 409 and the invitation stays open', async () => {
      const user = await createTestUser();
      const { invitation, token } = await inviteAs('Viewer', user.email);
      await withTenantConnection(tenantA(), (c) =>
        c.query(
          `insert into memberships (id, user_id, role_id, status, joined_at)
           select $1, $2, id, 'active', now() from roles where name = 'Viewer'`,
          [crypto.randomUUID(), user.id],
        ),
      );
      expect(problem((await accept({ token }).expect(409)).body).code).toBe('ALREADY_EXISTS');
      const row = await withOwnerClient(async (c) => {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantA()]);
        const { rows } = await c.query<{ accepted_at: Date | null }>(
          'select accepted_at from invitations where id = $1',
          [invitation.id],
        );
        await c.query('commit');
        return rows[0];
      });
      expect(row).toEqual({ accepted_at: null });
    });
  });

  async function current2(token: string, id: string): Promise<UserResponse> {
    return userResponseSchema.parse((await get(`/users/${id}`, token).expect(200)).body);
  }
});

async function expireInvitation(tenantId: string, id: string): Promise<void> {
  await withTenantConnection(tenantId, (c) =>
    c.query(`update invitations set expires_at = now() - interval '1 minute' where id = $1`, [id]),
  );
}
