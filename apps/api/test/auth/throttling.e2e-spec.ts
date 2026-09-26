import { randomInt } from 'node:crypto';
import { problemSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeGstin } from '../factories/gstin.js';
import { uniqueEmail } from '../factories/users.js';
import { createTestApp, http } from '../support/app.js';

/** A client IP no other run used in the last minute (limits live in the shared Redis). */
const randomIp = (): string => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

describe('rate limits on the public auth surface (Redis store)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      env: {
        // Behind one proxy: the client IP is the last X-Forwarded-For entry.
        TRUST_PROXY_HOPS: 1,
        THROTTLE_GSTIN_PER_MINUTE: 3,
        THROTTLE_AUTH_PER_MINUTE: 4,
        THROTTLE_ACCOUNT_PER_MINUTE: 2,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const expectRateLimited = (res: { status: number; body: unknown; headers: object }) => {
    expect(res.status).toBe(429);
    expect(problemSchema.parse(res.body)).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  };

  it('limits GSTIN lookups per client IP', async () => {
    const ip = randomIp();
    const gstin = activeGstin();
    for (let i = 0; i < 3; i++) {
      await http(app).get(`/api/v1/platform/gstin/${gstin}`).set('X-Forwarded-For', ip).expect(200);
    }
    const blocked = await http(app)
      .get(`/api/v1/platform/gstin/${gstin}`)
      .set('X-Forwarded-For', ip);
    expectRateLimited(blocked);
    expect(Number(blocked.headers['retry-after-gstin-ip'])).toBeGreaterThan(0);

    await http(app)
      .get(`/api/v1/platform/gstin/${gstin}`)
      .set('X-Forwarded-For', randomIp())
      .expect(200);
  });

  it('trusts only the configured proxy hop: a spoofed left-most address does not help', async () => {
    const ip = randomIp();
    const gstin = activeGstin();
    for (let i = 0; i < 3; i++) {
      await http(app)
        .get(`/api/v1/platform/gstin/${gstin}`)
        .set('X-Forwarded-For', `${randomIp()}, ${ip}`)
        .expect(200);
    }
    expectRateLimited(
      await http(app)
        .get(`/api/v1/platform/gstin/${gstin}`)
        .set('X-Forwarded-For', `${randomIp()}, ${ip}`),
    );
  });

  it('limits login attempts per email address across IPs', async () => {
    const email = uniqueEmail('target');
    for (let i = 0; i < 2; i++) {
      await http(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', randomIp())
        .send({ email, password: 'guess number one' })
        .expect(401);
    }
    expectRateLimited(
      await http(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', randomIp())
        .send({ email, password: 'guess number two' }),
    );
  });

  it('limits each auth route per client IP across emails', async () => {
    const ip = randomIp();
    for (let i = 0; i < 4; i++) {
      await http(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: uniqueEmail('spray'), password: 'guess number one' })
        .expect(401);
    }
    expectRateLimited(
      await http(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: uniqueEmail('spray'), password: 'guess number one' }),
    );
    // Another auth route has its own budget.
    await http(app).post('/api/v1/auth/logout').set('X-Forwarded-For', ip).expect(204);
  });
});
