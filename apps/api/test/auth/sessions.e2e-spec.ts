import {
  problemSchema,
  tenantSelectionResponseSchema,
  tokenResponseSchema,
} from '@ekaro/contracts';
import { JwtService } from '@nestjs/jwt';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessCache } from '../../src/modules/access/index.js';
import { hashRefreshToken } from '../../src/modules/auth/sessions/refresh-token.js';
import { refreshTokens } from '../../src/modules/auth/sessions/refresh-tokens.schema.js';
import { sessions } from '../../src/modules/auth/sessions/sessions.schema.js';
import { addMembership, createTestUser, setUserStatus, TEST_PASSWORD } from '../factories/users.js';
import { createTestApp, http } from '../support/app.js';
import {
  bearer,
  cookieHeader,
  logIn,
  me,
  REFRESH_COOKIE,
  refreshSetCookie,
  refreshTokenOf,
  type SignedUp,
  signUp,
} from '../support/auth.js';
import { loadTestEnv } from '../support/test-env.js';
import { testPlatformDb, withTenantConnection } from '../support/db.js';

const problem = (body: unknown) => problemSchema.parse(body);
const DAY_MS = 24 * 60 * 60 * 1000;
/** The Set-Cookie line that clears the refresh cookie. */
const CLEARED = new RegExp(`^${REFRESH_COOKIE}=;`);

async function familyIdOf(refreshToken: string): Promise<string> {
  const [row] = await testPlatformDb()
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
  if (row === undefined) throw new Error('no such refresh token');
  return row.familyId;
}

async function sessionOf(refreshToken: string) {
  const [session] = await testPlatformDb()
    .select()
    .from(sessions)
    .where(eq(sessions.id, await familyIdOf(refreshToken)));
  if (session === undefined) throw new Error('no session');
  return session;
}

/** Tokens of the session that could still be refreshed. */
async function liveTokens(familyId: string): Promise<number> {
  const rows = await testPlatformDb()
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  return rows.length;
}

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

      // A selection token is single-use: a replay cannot start a second session.
      const replay = await http(app)
        .post('/api/v1/auth/select-tenant')
        .send({ selectionToken: selection.selectionToken, tenantId: ownerA.body.tenant.id })
        .expect(401);
      expect(problem(replay.body).code).toBe('TOKEN_INVALID');
      expect(refreshSetCookie(replay)).toBeUndefined();
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
      expect(refreshSetCookie(replay)).toMatch(CLEARED);

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

    it('expires a refresh token after 7 idle days, never after the 30-day absolute end', async () => {
      const { refreshToken } = await logIn(app, ownerA.email, ownerA.password);
      const session = await sessionOf(refreshToken);
      const sinceLogin = session.absoluteExpiresAt.getTime() - session.createdAt.getTime();
      expect(sinceLogin).toBe(30 * DAY_MS);
      const [token] = await testPlatformDb()
        .select({ expiresAt: refreshTokens.expiresAt })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
      expect(Math.round(((token?.expiresAt.getTime() ?? 0) - Date.now()) / DAY_MS)).toBe(7);

      // A day before the absolute end, rotation caps the new token (and cookie) at that end.
      const end = new Date(Date.now() + DAY_MS);
      await testPlatformDb()
        .update(sessions)
        .set({ absoluteExpiresAt: end })
        .where(eq(sessions.id, session.id));
      const res = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(refreshToken))
        .expect(200);
      expect(refreshSetCookie(res)).toContain(`Expires=${end.toUTCString()}`);

      // Past the absolute end, even a live token is refused.
      await testPlatformDb()
        .update(sessions)
        .set({
          createdAt: new Date(Date.now() - 2 * DAY_MS),
          absoluteExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(sessions.id, session.id));
      const expired = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(refreshTokenOf(res)))
        .expect(401);
      expect(problem(expired.body).code).toBe('TOKEN_EXPIRED');
      expect(refreshSetCookie(expired)).toMatch(CLEARED);
    });

    it('never leaves a live token when logout races a refresh of the same session', async () => {
      for (let round = 0; round < 10; round++) {
        const { refreshToken } = await logIn(app, ownerA.email, ownerA.password);
        const familyId = await familyIdOf(refreshToken);
        const [refreshed, loggedOut] = await Promise.all([
          http(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(refreshToken)),
          http(app).post('/api/v1/auth/logout').set('Cookie', cookieHeader(refreshToken)),
        ]);
        expect(loggedOut.status).toBe(204);
        expect([200, 401]).toContain(refreshed.status);
        expect(await liveTokens(familyId)).toBe(0);
        expect((await sessionOf(refreshToken)).revokedReason).toBe('logout');
      }
    });
  });

  describe('logout', () => {
    it('ends the session and clears the cookie; the token cannot be refreshed any more', async () => {
      const { refreshToken } = await logIn(app, ownerA.email, ownerA.password);
      const res = await http(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader(refreshToken))
        .expect(204);
      expect(refreshSetCookie(res)).toBe(
        `${REFRESH_COOKIE}=; Path=/api/v1/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`,
      );
      expect((await familyOf(refreshToken)).map((t) => t.revokedReason)).toEqual(['logout']);
      expect((await sessionOf(refreshToken)).revokedReason).toBe('logout');
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
    const switchTo = (tenantId: string, accessToken?: string, refreshToken?: string) => {
      let req = http(app).post('/api/v1/auth/switch-tenant');
      if (accessToken !== undefined) req = req.set('Authorization', bearer(accessToken));
      if (refreshToken !== undefined) req = req.set('Cookie', cookieHeader(refreshToken));
      return req.send({ tenantId });
    };

    it('moves the session to another company and ends the old session', async () => {
      const inA = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      const oldSession = await sessionOf(inA.refreshToken);
      const res = await switchTo(ownerB.body.tenant.id, inA.body.accessToken, inA.refreshToken);
      expect(res.status).toBe(200);
      const inB = tokenResponseSchema.parse(res.body);
      expect(inB.tenant.id).toBe(ownerB.body.tenant.id);
      expect(inB.membership.role.name).toBe('Viewer');
      const session = await me(app, inB.accessToken);
      expect(session.tenant.id).toBe(ownerB.body.tenant.id);
      expect(session.permissions).not.toContain('audit.log:view');

      expect((await familyOf(inA.refreshToken)).map((t) => t.revokedReason)).toEqual(['switched']);
      expect((await sessionOf(inA.refreshToken)).revokedReason).toBe('switched');
      const newSession = await sessionOf(refreshTokenOf(res));
      expect(newSession).toMatchObject({ revokedAt: null, membershipId: inB.membership.id });
      // Switching never extends the login: the new session keeps the old absolute end.
      expect(newSession.absoluteExpiresAt).toEqual(oldSession.absoluteExpiresAt);
    });

    it('401 without the refresh cookie, and the session stays usable', async () => {
      const inA = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      const res = await switchTo(ownerB.body.tenant.id, inA.body.accessToken).expect(401);
      expect(problem(res.body).code).toBe('UNAUTHENTICATED');
      expect(refreshSetCookie(res)).toMatch(CLEARED);
      expect((await sessionOf(inA.refreshToken)).revokedAt).toBeNull();
    });

    it('401 after logout, although the access token is still valid', async () => {
      const inA = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      await http(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieHeader(inA.refreshToken))
        .expect(204);
      await me(app, inA.body.accessToken);

      const res = await switchTo(ownerB.body.tenant.id, inA.body.accessToken, inA.refreshToken);
      expect(res.status).toBe(401);
      expect(problem(res.body).code).toBe('REFRESH_REUSED');
      expect(refreshSetCookie(res)).toMatch(CLEARED);
      expect(await liveTokens(await familyIdOf(inA.refreshToken))).toBe(0);
    });

    it('401 after reuse detection ended the session', async () => {
      const inA = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      const rotated = await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(inA.refreshToken))
        .expect(200);
      await http(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(inA.refreshToken))
        .expect(401);

      const res = await switchTo(
        ownerB.body.tenant.id,
        inA.body.accessToken,
        refreshTokenOf(rotated),
      );
      expect(res.status).toBe(401);
      expect(problem(res.body).code).toBe('REFRESH_REUSED');
      expect(refreshSetCookie(res)).toMatch(CLEARED);
      expect((await sessionOf(inA.refreshToken)).revokedReason).toBe('reuse_detected');
      expect(await liveTokens(await familyIdOf(inA.refreshToken))).toBe(0);
    });

    it('401 when the cookie belongs to another session, which is left alone', async () => {
      const first = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      const second = await logIn(app, consultant.email, TEST_PASSWORD, ownerA.body.tenant.id);
      const res = await switchTo(
        ownerB.body.tenant.id,
        first.body.accessToken,
        second.refreshToken,
      ).expect(401);
      expect(problem(res.body).code).toBe('TOKEN_INVALID');
      expect((await sessionOf(first.refreshToken)).revokedAt).toBeNull();
      expect((await sessionOf(second.refreshToken)).revokedAt).toBeNull();
    });

    it('403 for a company the user does not belong to, keeping the session; 401 without a session', async () => {
      const denied = await switchTo(
        ownerB.body.tenant.id,
        ownerA.body.accessToken,
        ownerA.refreshToken,
      ).expect(403);
      expect(problem(denied.body).code).toBe('FORBIDDEN');
      expect(refreshSetCookie(denied)).toBeUndefined();
      expect((await sessionOf(ownerA.refreshToken)).revokedAt).toBeNull();
      await switchTo(ownerB.body.tenant.id).expect(401);
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
