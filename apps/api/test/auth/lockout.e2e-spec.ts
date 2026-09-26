import { problemSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../src/modules/auth/users/users.schema.js';
import { addMembership, createTestUser, TEST_PASSWORD } from '../factories/users.js';
import { createTestApp, http } from '../support/app.js';
import { logIn, signUp } from '../support/auth.js';
import { testPlatformDb } from '../support/db.js';

const MINUTE_MS = 60_000;

describe('login lockout (5 failures → 15 minutes, 423 ACCOUNT_LOCKED)', () => {
  let app: NestExpressApplication;
  let email: string;
  let userId: string;

  const attempt = (password: string) =>
    http(app).post('/api/v1/auth/login').send({ email, password });
  const state = async () => {
    const [row] = await testPlatformDb()
      .select({ failed: users.failedLoginCount, lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  };

  beforeAll(async () => {
    app = await createTestApp();
    const owner = await signUp(app);
    const user = await createTestUser();
    await addMembership(owner.body.tenant.id, user.id, 'Viewer');
    email = user.email;
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts failures, and a success resets the count', async () => {
    for (let i = 0; i < 3; i++) await attempt('wrong password').expect(401);
    expect(await state()).toEqual({ failed: 3, lockedUntil: null });
    await logIn(app, email);
    expect(await state()).toEqual({ failed: 0, lockedUntil: null });
  });

  it('locks on the fifth consecutive failure, for 15 minutes', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await attempt('wrong password').expect(401);
      expect(problemSchema.parse(res.body).code).toBe('INVALID_CREDENTIALS');
    }
    const fifth = await attempt('wrong password').expect(423);
    expect(problemSchema.parse(fifth.body)).toMatchObject({
      status: 423,
      title: 'Locked',
      code: 'ACCOUNT_LOCKED',
    });
    const locked = await state();
    expect(locked?.failed).toBe(0);
    const remaining = (locked?.lockedUntil?.getTime() ?? 0) - Date.now();
    expect(remaining).toBeGreaterThan(14 * MINUTE_MS);
    expect(remaining).toBeLessThanOrEqual(15 * MINUTE_MS);
  });

  it('refuses even the right password while locked, without counting it', async () => {
    const res = await attempt(TEST_PASSWORD).expect(423);
    expect(problemSchema.parse(res.body).code).toBe('ACCOUNT_LOCKED');
    expect((await state())?.failed).toBe(0);
  });

  it('lets the user in once the lock has expired', async () => {
    await testPlatformDb()
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, userId));
    await logIn(app, email);
    expect(await state()).toEqual({ failed: 0, lockedUntil: null });
  });
});
