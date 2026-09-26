import {
  problemSchema,
  tenantSelectionResponseSchema,
  tokenResponseSchema,
} from '@ekaro/contracts';
import { JwtService } from '@nestjs/jwt';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessCache } from '../../src/modules/access/index.js';
import { hashRefreshToken } from '../../src/modules/auth/sessions/refresh-token.js';
import { refreshTokens } from '../../src/modules/auth/sessions/refresh-tokens.schema.js';
import { addMembership, createTestUser, setUserStatus, TEST_PASSWORD } from '../factories/users.js';
import { createTestApp, http } from '../support/app.js';
import {
  bearer,
  cookieHeader,
  logIn,
  me,
  refreshSetCookie,
  refreshTokenOf,
  type SignedUp,
  signUp,
} from '../support/auth.js';
import { loadTestEnv } from '../support/test-env.js';
import { testPlatformDb, withTenantConnection } from '../support/db.js';

const problem = (body: unknown) => problemSchema.parse(body);

async function familyOf(refreshToken: string) {
  const db = testPlatformDb();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
  if (row === undefined) throw new Error('no such refresh token');
  return db
    .select({
      tokenHash: refreshTokens.tokenHash,
      revokedReason: refreshTokens.revokedReason,
      replacedById: refreshTokens.replacedById,
      id: refreshTokens.id,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.familyId, row.familyId))
    .orderBy(asc(refreshTokens.createdAt), asc(refreshTokens.id));
}

describe('auth sessions', () => {
  let app: NestExpressApplication;
  /** Two companies; the consultant is an Accountant in A and a Viewer in B. */
  let ownerA: SignedUp;
  let ownerB: SignedUp;
  let consultant: { id: string; email: string };

  beforeAll(async () => {
    app = await createTestApp();
    [ownerA, ownerB] = await Promise.all([signUp(app), signUp(app)]);
    const user = await createTestUser();
    consultant = { id: user.id, email: user.email };
    await addMembership(ownerA.body.tenant.id, user.id, 'Accountant');
    await addMembership(ownerB.body.tenant.id, user.id, 'Viewer');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('login', () => {
    it('logs straight into the only company', async () => {
      const { body, refreshToken } = await logIn(app, ownerA.email, ownerA.password);
      expect(body.tenant.id).toBe(ownerA.body.tenant.id);
      expect(body.membership.role.name).toBe('Owner');
      expect(refreshToken).toMatch(/^[\w-]{43}$/);
    });

    it('answers 401 INVALID_CREDENTIALS alike for a wrong password and an unknown email', async () => {
      for (const email of [ownerA.email, `nobody-${ownerA.email}`]) {
        const res = await http(app)
          .post('/api/v1/auth/login')
          .send({ email, password: 'not the password' })
          .expect(401);
        expect(problem(res.body)).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          detail: 'The email or password is incorrect.',
        });
        expect(refreshSetCookie(res)).toBeUndefined();
      }
    });

    it('asks a user with two companies to choose, then select-tenant starts the session', async () => {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: consultant.email, password: TEST_PASSWORD })
        .expect(200);
      expect(refreshSetCookie(res)).toBeUndefined();
      const selection = tenantSelectionResponseSchema.parse(res.body);
      expect(selection.tenants).toEqual([
        {
          tenantId: ownerA.body.tenant.id,
          name: ownerA.body.tenant.name,
          slug: ownerA.body.tenant.slug,
          roleName: 'Accountant',
        },
        {
          tenantId: ownerB.body.tenant.id,
          name: ownerB.body.tenant.name,
          slug: ownerB.body.tenant.slug,
          roleName: 'Viewer',
        },
      ]);

      const selected = await http(app)
        .post('/api/v1/auth/select-tenant')
        .send({ selectionToken: selection.selectionToken, tenantId: ownerB.body.tenant.id })
        .expect(200);
      const body = tokenResponseSchema.parse(selected.body);
      expect(body.tenant.id).toBe(ownerB.body.tenant.id);
      expect(body.membership.role.name).toBe('Viewer');
      expect(refreshTokenOf(selected)).toMatch(/^[\w-]{43}$/);
    });

    it('logs into the requested company directly when tenantId is given', async () => {
      const { body } = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      expect(body.membership.role.name).toBe('Accountant');
    });

    it('refuses a company the user does not belong to (403), and a forged selection token (401)', async () => {
      const denied = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: ownerA.email, password: ownerA.password, tenantId: ownerB.body.tenant.id })
        .expect(403);
      expect(problem(denied.body).code).toBe('FORBIDDEN');

      const forged = await http(app)
        .post('/api/v1/auth/select-tenant')
        .send({ selectionToken: ownerA.body.accessToken, tenantId: ownerA.body.tenant.id })
        .expect(401);
      expect(problem(forged.body).code).toBe('TOKEN_INVALID');
    });
  });

  describe('refresh', () => {
    it('rotates the token: a new cookie and access token, the old token marked rotated', async () => {
      const first = await logIn(app, ownerA.email, ownerA.password);
      const res = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(first.refreshToken))
        .expect(200);
      const next = refreshTokenOf(res);
      const body = tokenResponseSchema.parse(res.body);
      expect(next).not.toBe(first.refreshToken);
      expect(body.user.id).toBe(ownerA.body.user.id);
      expect((await me(app, body.accessToken)).tenant.id).toBe(ownerA.body.tenant.id);

      const family = await familyOf(first.refreshToken);
      expect(family).toEqual([
        expect.objectContaining({
          tokenHash: hashRefreshToken(first.refreshToken),
          revokedReason: 'rotated',
          replacedById: family[1]?.id,
        }),
        expect.objectContaining({
          tokenHash: hashRefreshToken(next),
          revokedReason: null,
          replacedById: null,
        }),
      ]);
    });

    it('detects reuse of a rotated token: 401 REFRESH_REUSED and the whole session ends', async () => {
      const first = await logIn(app, ownerA.email, ownerA.password);
      const rotated = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(first.refreshToken))
        .expect(200);
      const current = refreshTokenOf(rotated);

      const replay = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(first.refreshToken))
        .expect(401);
      expect(problem(replay.body).code).toBe('REFRESH_REUSED');
      expect(refreshSetCookie(replay)).toMatch(/^ekaro_refresh=;/);

      const legit = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(current))
        .expect(401);
      expect(problem(legit.body).code).toBe('REFRESH_REUSED');
      expect((await familyOf(current)).map((t) => t.revokedReason)).toEqual([
        'rotated',
        'reuse_detected',
      ]);
    });

    it('401 without a cookie, with an unknown token and with an expired one', async () => {
      const none = await http(app).post('/api/v1/auth/refresh').expect(401);
      expect(problem(none.body).code).toBe('UNAUTHENTICATED');

      const unknown = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader('A'.repeat(43)))
        .expect(401);
      expect(problem(unknown.body).code).toBe('TOKEN_INVALID');

      const { refreshToken } = await logIn(app, ownerA.email, ownerA.password);
      await testPlatformDb()
        .update(refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
      const expired = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(refreshToken))
        .expect(401);
      expect(problem(expired.body).code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('logout', () => {
    it('ends the session and clears the cookie; the token cannot be refreshed any more', async () => {
      const { refreshToken } = await logIn(app, ownerA.email, ownerA.password);
      const res = await http(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader(refreshToken))
        .expect(204);
      expect(refreshSetCookie(res)).toMatch(
        /^ekaro_refresh=; Path=\/api\/v1\/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict$/,
      );
      expect((await familyOf(refreshToken)).map((t) => t.revokedReason)).toEqual(['logout']);
      await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(refreshToken))
        .expect(401);
    });

    it('is idempotent and works without any session', async () => {
      await http(app).post('/api/v1/auth/logout').expect(204);
    });
  });

  describe('switch-tenant', () => {
    it('moves the session to another company and ends the old session', async () => {
      const inA = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      const res = await http(app)
        .post('/api/v1/auth/switch-tenant')
        .set('Authorization', bearer(inA.body.accessToken))
        .send({ tenantId: ownerB.body.tenant.id })
        .expect(200);
      const inB = tokenResponseSchema.parse(res.body);
      expect(inB.tenant.id).toBe(ownerB.body.tenant.id);
      expect(inB.membership.role.name).toBe('Viewer');
      const session = await me(app, inB.accessToken);
      expect(session.tenant.id).toBe(ownerB.body.tenant.id);
      expect(session.permissions).not.toContain('audit.log:view');

      expect((await familyOf(inA.refreshToken)).map((t) => t.revokedReason)).toEqual(['switched']);
      expect((await familyOf(refreshTokenOf(res))).map((t) => t.revokedReason)).toEqual([null]);
    });

    it('403 for a company the user does not belong to; 401 without a session', async () => {
      const denied = await http(app)
        .post('/api/v1/auth/switch-tenant')
        .set('Authorization', bearer(ownerA.body.accessToken))
        .send({ tenantId: ownerB.body.tenant.id })
        .expect(403);
      expect(problem(denied.body).code).toBe('FORBIDDEN');
      await http(app)
        .post('/api/v1/auth/switch-tenant')
        .send({ tenantId: ownerB.body.tenant.id })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns user, tenant, membership with branch scope and effective permissions', async () => {
      const { body } = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      expect(await me(app, body.accessToken)).toEqual({
        user: {
          id: consultant.id,
          email: consultant.email,
          fullName: 'Test User',
          mobile: '+919876543210',
        },
        tenant: ownerA.body.tenant,
        membership: body.membership,
        permissions: expect.arrayContaining(['masters.company:edit', 'audit.log:view']) as string[],
      });
    });

    it('401 UNAUTHENTICATED without a token, TOKEN_INVALID for a bad one, TOKEN_EXPIRED for an old one', async () => {
      const none = await http(app).get('/api/v1/auth/me').expect(401);
      expect(problem(none.body).code).toBe('UNAUTHENTICATED');

      const bad = await http(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer a.b.c')
        .expect(401);
      expect(problem(bad.body).code).toBe('TOKEN_INVALID');

      const env = loadTestEnv();
      const past = Math.floor(Date.now() / 1000) - 3600;
      const old = await new JwtService({ secret: env.JWT_ACCESS_SECRET }).signAsync(
        {
          tid: ownerA.body.tenant.id,
          mid: ownerA.body.membership.id,
          sid: ownerA.body.user.id,
          iat: past,
        },
        {
          subject: ownerA.body.user.id,
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
          expiresIn: 60,
        },
      );
      const expired = await http(app)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(old))
        .expect(401);
      expect(problem(expired.body).code).toBe('TOKEN_EXPIRED');
    });

    it('stops a disabled membership once its cache entry is invalidated, and on refresh', async () => {
      const user = await createTestUser();
      const membershipId = await addMembership(ownerA.body.tenant.id, user.id, 'Sales');
      const session = await logIn(app, user.email);
      await me(app, session.body.accessToken);

      await withTenantConnection(ownerA.body.tenant.id, (c) =>
        c.query(`update memberships set status = 'disabled' where id = $1`, [membershipId]),
      );
      // Cached for up to 60 seconds (ADR 0007) until the change calls the invalidation hook.
      await me(app, session.body.accessToken);
      await app.get(AccessCache).invalidateMembership(ownerA.body.tenant.id, membershipId);

      const denied = await http(app)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(session.body.accessToken))
        .expect(403);
      expect(problem(denied.body).code).toBe('FORBIDDEN');

      const refresh = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(session.refreshToken))
        .expect(403);
      expect(problem(refresh.body).code).toBe('FORBIDDEN');
      expect((await familyOf(session.refreshToken)).map((t) => t.revokedReason)).toEqual([
        'rotated',
        'access_revoked',
      ]);
    });

    it('stops a disabled user: 401 ACCOUNT_DISABLED on requests and on login', async () => {
      const user = await createTestUser();
      await addMembership(ownerB.body.tenant.id, user.id, 'Store');
      const session = await logIn(app, user.email);

      await setUserStatus(user.id, 'disabled');
      await app.get(AccessCache).invalidateTenant(ownerB.body.tenant.id);

      const denied = await http(app)
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(session.body.accessToken))
        .expect(401);
      expect(problem(denied.body).code).toBe('ACCOUNT_DISABLED');
      const login = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(401);
      expect(problem(login.body).code).toBe('ACCOUNT_DISABLED');
    });
  });
});
