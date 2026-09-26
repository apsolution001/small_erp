import { problemSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REDIS } from '../../src/infra/redis/redis.module.js';
import { PasswordHasher } from '../../src/modules/auth/passwords/password-hasher.js';
import { LoginLockout } from '../../src/modules/auth/users/login-lockout.js';
import { addMembership, createTestUser, TEST_PASSWORD, uniqueEmail } from '../factories/users.js';
import { createTestApp, http } from '../support/app.js';
import { logIn, signUp } from '../support/auth.js';

const MINUTE_MS = 60_000;

describe('login lockout (5 failures → 15 minutes, 423 ACCOUNT_LOCKED)', () => {
  let app: NestExpressApplication;
  let lockout: LoginLockout;
  let email: string;

  const attempt = (password: string, as = email) =>
    http(app).post('/api/v1/auth/login').send({ email: as, password });
  const codeOf = (body: unknown) => problemSchema.parse(body).code;

  beforeAll(async () => {
    app = await createTestApp();
    lockout = app.get(LoginLockout);
    const owner = await signUp(app);
    const user = await createTestUser();
    await addMembership(owner.body.tenant.id, user.id, 'Viewer');
    email = user.email;
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts failures, and a success resets the count', async () => {
    for (let i = 0; i < 3; i++) await attempt('wrong password').expect(401);
    expect(await lockout.state(email)).toEqual({ failures: 3, lockedForMs: 0 });
    await logIn(app, email);
    expect(await lockout.state(email)).toEqual({ failures: 0, lockedForMs: 0 });
  });

  it('locks on the fifth consecutive failure, for 15 minutes', async () => {
    for (let i = 0; i < 4; i++) {
      expect(codeOf((await attempt('wrong password').expect(401)).body)).toBe(
        'INVALID_CREDENTIALS',
      );
    }
    const fifth = await attempt('wrong password').expect(423);
    expect(problemSchema.parse(fifth.body)).toMatchObject({
      status: 423,
      title: 'Locked',
      code: 'ACCOUNT_LOCKED',
    });
    const locked = await lockout.state(email);
    expect(locked.failures).toBe(0);
    expect(locked.lockedForMs).toBeGreaterThan(14 * MINUTE_MS);
    expect(locked.lockedForMs).toBeLessThanOrEqual(15 * MINUTE_MS);
  });

  it('refuses even the right password while locked, spending a bcrypt check, without counting it', async () => {
    const spend = vi.spyOn(app.get(PasswordHasher), 'verifyNothing');
    const res = await attempt(TEST_PASSWORD, email.toUpperCase()).expect(423);
    expect(codeOf(res.body)).toBe('ACCOUNT_LOCKED');
    expect(spend).toHaveBeenCalledOnce();
    spend.mockRestore();
    expect((await lockout.state(email)).failures).toBe(0);
  });

  it('lets the user in once the lock has ended', async () => {
    await lockout.clear(email);
    await logIn(app, email);
    expect(await lockout.state(email)).toEqual({ failures: 0, lockedForMs: 0 });
  });

  it('locks an unknown email exactly like a registered one', async () => {
    const nobody = uniqueEmail('nobody');
    const answers: [number, string][] = [];
    for (let i = 0; i < 6; i++) {
      const res = await attempt('wrong password', nobody);
      answers.push([res.status, codeOf(res.body)]);
    }
    expect(answers).toEqual([
      [401, 'INVALID_CREDENTIALS'],
      [401, 'INVALID_CREDENTIALS'],
      [401, 'INVALID_CREDENTIALS'],
      [401, 'INVALID_CREDENTIALS'],
      [423, 'ACCOUNT_LOCKED'],
      [423, 'ACCOUNT_LOCKED'],
    ]);
  });

  it('keeps no email in Redis: lockout keys use a keyed pseudonym', async () => {
    const keys = await app.get<Redis>(REDIS).keys('ekaro:login-lockout:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join('\n')).not.toContain('@');
  });
});
