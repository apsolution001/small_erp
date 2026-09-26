import { uuidv7 } from '@ekaro/core';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../common/errors/domain-error.js';
import { type Env } from '../../../config/env.js';
import { AccessTokenService, SELECTION_TOKEN_TTL_SECONDS } from './access-token.service.js';

const env = {
  JWT_ACCESS_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_ISSUER: 'ekaro-api',
  JWT_AUDIENCE: 'ekaro-web',
} as Env;

class FixedClock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
}

const T0 = new Date('2026-09-26T10:00:00.000Z');
const claims = {
  userId: uuidv7(),
  tenantId: uuidv7(),
  membershipId: uuidv7(),
  sessionId: uuidv7(),
};

function setup() {
  const clock = new FixedClock(T0);
  return { clock, tokens: new AccessTokenService(env, clock) };
}

async function rejection(promise: Promise<unknown>): Promise<UnauthorizedError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UnauthorizedError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('AccessTokenService: access tokens (ADR 0006)', () => {
  it('signs HS256 tokens with sub, tid, mid, sid, iss, aud and a 15-minute expiry', async () => {
    const { tokens } = setup();
    const token = await tokens.signAccess(claims);
    const decoded: unknown = new JwtService().decode(token, { complete: true });
    expect(decoded).toMatchObject({
      header: { alg: 'HS256', typ: 'JWT' },
      payload: {
        sub: claims.userId,
        tid: claims.tenantId,
        mid: claims.membershipId,
        sid: claims.sessionId,
        iss: 'ekaro-api',
        aud: 'ekaro-web',
        iat: T0.getTime() / 1000,
        exp: T0.getTime() / 1000 + 900,
      },
    });
    expect(await tokens.verifyAccess(token)).toEqual(claims);
  });

  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const { clock, tokens } = setup();
    const token = await tokens.signAccess(claims);
    clock.current = new Date(T0.getTime() + 901_000);
    expect((await rejection(tokens.verifyAccess(token))).code).toBe('TOKEN_EXPIRED');
  });

  it('rejects tampered, foreign-key, wrong-audience and unsigned tokens with TOKEN_INVALID', async () => {
    const { tokens } = setup();
    const token = await tokens.signAccess(claims);
    const [header, payload, signature] = token.split('.');
    const forged = `${header}.${Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url')}.${signature}`;
    const otherKey = await new JwtService({
      secret: 'another-secret-another-secret-12345',
    }).signAsync(
      { tid: claims.tenantId, mid: claims.membershipId, sid: claims.sessionId },
      { subject: claims.userId, issuer: 'ekaro-api', audience: 'ekaro-web' },
    );
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
    const selection = await tokens.signSelection(claims.userId);
    for (const bad of [forged, otherKey, unsigned, selection, 'not-a-jwt']) {
      expect((await rejection(tokens.verifyAccess(bad))).code, bad).toBe('TOKEN_INVALID');
    }
  });

  it('rejects a well-signed token whose claims are not ids', async () => {
    const { tokens } = setup();
    const token = await new JwtService({ secret: env.JWT_ACCESS_SECRET }).signAsync(
      {
        tid: 'tenant-1',
        mid: claims.membershipId,
        sid: claims.sessionId,
        iat: T0.getTime() / 1000,
      },
      {
        subject: claims.userId,
        issuer: 'ekaro-api',
        audience: 'ekaro-web',
        expiresIn: 60,
      },
    );
    expect((await rejection(tokens.verifyAccess(token))).code).toBe('TOKEN_INVALID');
  });
});

describe('AccessTokenService: tenant-selection tokens', () => {
  it('round-trips the user for 5 minutes and cannot be used as an access token', async () => {
    const { clock, tokens } = setup();
    const token = await tokens.signSelection(claims.userId);
    expect(await tokens.verifySelection(token)).toBe(claims.userId);
    expect((await rejection(tokens.verifyAccess(token))).code).toBe('TOKEN_INVALID');

    clock.current = new Date(T0.getTime() + (SELECTION_TOKEN_TTL_SECONDS + 1) * 1000);
    expect((await rejection(tokens.verifySelection(token))).code).toBe('TOKEN_EXPIRED');
  });

  it('does not accept an access token as a selection token', async () => {
    const { tokens } = setup();
    const access = await tokens.signAccess(claims);
    expect((await rejection(tokens.verifySelection(access))).code).toBe('TOKEN_INVALID');
  });
});
