import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv, parseMigrationEnv, type RawEnv } from './env.js';

const valid: RawEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  APP_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'debug',
  DATABASE_URL_OWNER: 'postgres://ekaro_owner:pw@localhost:5432/ekaro',
  DATABASE_URL_APP: 'postgres://ekaro_app:pw@localhost:5432/ekaro',
  DATABASE_URL_PLATFORM: 'postgresql://ekaro_platform:pw@localhost:5432/ekaro',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a-development-secret-that-is-at-least-32-chars',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_ISSUER: 'ekaro-api',
  JWT_AUDIENCE: 'ekaro-web',
  SESSION_IDLE_DAYS: '7',
  SESSION_ABSOLUTE_DAYS: '30',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GSP_PROVIDER: 'mock',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Ekaro <no-reply@ekaro.local>',
};

/**
 * Production with a real secret and an explicit proxy hop count. It still fails on
 * `GSP_PROVIDER`: only the mock adapter exists yet, and production refuses it.
 */
const production: RawEnv = {
  ...valid,
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'a-production-secret-that-is-at-least-32-chars',
  TRUST_PROXY_HOPS: '1',
};

function errorOf(raw: RawEnv): EnvValidationError {
  try {
    parseEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected parseEnv to throw');
}

describe('parseEnv', () => {
  it('parses and coerces a valid environment', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.SESSION_IDLE_DAYS).toBe(7);
    expect(env.SESSION_ABSOLUTE_DAYS).toBe(30);
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DATABASE_URL_PLATFORM).toBe(valid.DATABASE_URL_PLATFORM);
  });

  it('defaults the session and throttling settings to their secure values', () => {
    const env = parseEnv(valid);
    expect(env.REFRESH_COOKIE_SECURE).toBe(true);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.THROTTLE_AUTH_PER_MINUTE).toBe(20);
    expect(env.THROTTLE_ACCOUNT_PER_MINUTE).toBe(10);
    expect(env.THROTTLE_GSTIN_PER_MINUTE).toBe(10);
  });

  it('parses REFRESH_COOKIE_SECURE=false for local http, but not in production', () => {
    expect(parseEnv({ ...valid, REFRESH_COOKIE_SECURE: 'false' }).REFRESH_COOKIE_SECURE).toBe(
      false,
    );
    const error = errorOf({ ...production, REFRESH_COOKIE_SECURE: 'false' });
    expect(error.issues.map((i) => i.variable)).toEqual(['REFRESH_COOKIE_SECURE', 'GSP_PROVIDER']);
  });

  it('refuses the mock GSP in production', () => {
    expect(errorOf(production).issues).toEqual([
      { variable: 'GSP_PROVIDER', message: 'the mock GSP must not be used in production' },
    ]);
  });

  it('requires TRUST_PROXY_HOPS to be set explicitly in production (0 is allowed)', () => {
    const { TRUST_PROXY_HOPS: _t, ...unset } = production;
    expect(errorOf(unset).issues.map((i) => i.variable)).toEqual([
      'GSP_PROVIDER',
      'TRUST_PROXY_HOPS',
    ]);
    expect(errorOf({ ...production, TRUST_PROXY_HOPS: '0' }).issues.map((i) => i.variable)).toEqual(
      ['GSP_PROVIDER'],
    );
    expect(parseEnv({ ...valid, TRUST_PROXY_HOPS: undefined }).TRUST_PROXY_HOPS).toBe(0);
  });

  it('defaults the session lifetimes (7 days idle, 30 days absolute) and keeps idle within absolute', () => {
    const { SESSION_IDLE_DAYS: _i, SESSION_ABSOLUTE_DAYS: _a, ...rest } = valid;
    const env = parseEnv(rest);
    expect([env.SESSION_IDLE_DAYS, env.SESSION_ABSOLUTE_DAYS]).toEqual([7, 30]);
    expect(
      errorOf({ ...valid, SESSION_IDLE_DAYS: '31', SESSION_ABSOLUTE_DAYS: '30' }).issues,
    ).toEqual([
      { variable: 'SESSION_IDLE_DAYS', message: 'must not exceed SESSION_ABSOLUTE_DAYS' },
    ]);
  });

  it('rejects an out-of-range proxy hop count', () => {
    expect(errorOf({ ...valid, TRUST_PROXY_HOPS: '-1' }).issues.map((i) => i.variable)).toEqual([
      'TRUST_PROXY_HOPS',
    ]);
  });

  it('applies defaults for optional settings', () => {
    const { NODE_ENV: _n, PORT: _p, LOG_LEVEL: _l, ...rest } = valid;
    const env = parseEnv(rest);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('does not require the owner URL at runtime (the API never connects as owner)', () => {
    const { DATABASE_URL_OWNER: _o, ...rest } = valid;
    expect(parseEnv(rest).DATABASE_URL_OWNER).toBeUndefined();
  });

  it('ignores unrelated variables', () => {
    expect(parseEnv({ ...valid, PATH: '/usr/bin', HOME: '/root' })).not.toHaveProperty('PATH');
  });

  it('lists every invalid variable by name in one readable message', () => {
    const error = errorOf({
      ...valid,
      DATABASE_URL_APP: 'not a url',
      DATABASE_URL_PLATFORM: 'mysql://x@localhost/ekaro',
      REDIS_URL: undefined,
      PORT: 'eighty',
    });
    expect(error.message).toMatch(/^Invalid environment configuration:\n/);
    expect(error.issues.map((i) => i.variable).sort()).toEqual([
      'DATABASE_URL_APP',
      'DATABASE_URL_PLATFORM',
      'PORT',
      'REDIS_URL',
    ]);
    expect(error.message).toContain('  - DATABASE_URL_APP: ');
    expect(error.message).toContain('  - REDIS_URL: ');
  });

  it('says "is required" for a missing variable, whatever its type', () => {
    const { REDIS_URL: _r, SMTP_PORT: _s, ...rest } = valid;
    expect(errorOf(rest).issues).toEqual([
      { variable: 'REDIS_URL', message: 'is required' },
      { variable: 'SMTP_PORT', message: 'is required' },
    ]);
  });

  it('never echoes a rejected value into the message (it may be a secret)', () => {
    const error = errorOf({ ...valid, JWT_ACCESS_SECRET: 'short-secret-value' });
    expect(error.issues.map((i) => i.variable)).toEqual(['JWT_ACCESS_SECRET']);
    expect(error.message).not.toContain('short-secret-value');
  });

  it('requires DATA_ENCRYPTION_KEY to decode to exactly 32 bytes', () => {
    const error = errorOf({
      ...valid,
      DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
    });
    expect(error.issues.map((i) => i.variable)).toEqual(['DATA_ENCRYPTION_KEY']);
  });

  it('rejects the example JWT secret in production', () => {
    const error = errorOf({
      ...production,
      JWT_ACCESS_SECRET: 'change-me-to-a-long-random-string-at-least-32-chars',
    });
    expect(error.issues.map((i) => i.variable)).toEqual(['JWT_ACCESS_SECRET', 'GSP_PROVIDER']);
  });

  it('rejects an unknown GSP provider and log level', () => {
    const error = errorOf({ ...valid, GSP_PROVIDER: 'acme', LOG_LEVEL: 'verbose' });
    expect(error.issues.map((i) => i.variable).sort()).toEqual(['GSP_PROVIDER', 'LOG_LEVEL']);
  });
});

describe('parseMigrationEnv', () => {
  it('needs only the owner URL', () => {
    expect(parseMigrationEnv({ DATABASE_URL_OWNER: valid.DATABASE_URL_OWNER })).toEqual({
      DATABASE_URL_OWNER: valid.DATABASE_URL_OWNER,
    });
  });

  it('fails readably without it', () => {
    expect(() => parseMigrationEnv({})).toThrow(
      /Invalid environment configuration:\n {2}- DATABASE_URL_OWNER: /,
    );
  });
});
