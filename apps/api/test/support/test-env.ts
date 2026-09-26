import { type Env, parseEnv, parseMigrationEnv } from '../../src/config/env.js';

/**
 * Test configuration: the normal environment (`.env`, loaded by vitest.config.ts, or CI's env)
 * re-pointed at the test database. `TEST_DB_NAME` (default `ekaro_test`) lets several engineers
 * or worktrees share one Postgres; it must end in `_test` so a dev database is never migrated
 * over or filled with fixtures by accident.
 */
export const DEFAULT_TEST_DB = 'ekaro_test';

export type TestEnv = Env & { DATABASE_URL_OWNER: string };

export function testDatabaseName(): string {
  const name = process.env.TEST_DB_NAME ?? DEFAULT_TEST_DB;
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`TEST_DB_NAME must be a lowercase name ending in "_test", got "${name}"`);
  }
  return name;
}

function onDatabase(url: string | undefined, database: string): string | undefined {
  if (url === undefined) return undefined;
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Rate limits are effectively off in e2e runs: every test file hits the auth routes from the same
 * loopback address and shares one Redis. The throttling tests set low limits of their own.
 */
const UNTHROTTLED = '1000000';

export function loadTestEnv(): TestEnv {
  const raw = process.env;
  const database = testDatabaseName();
  const overrides = {
    NODE_ENV: 'test',
    LOG_LEVEL: raw.TEST_LOG_LEVEL ?? 'silent',
    THROTTLE_AUTH_PER_MINUTE: UNTHROTTLED,
    THROTTLE_ACCOUNT_PER_MINUTE: UNTHROTTLED,
    THROTTLE_GSTIN_PER_MINUTE: UNTHROTTLED,
    // As deployed: a Secure `__Secure-` cookie (supertest sends it over http regardless).
    REFRESH_COOKIE_SECURE: 'true',
    DATABASE_URL_OWNER: onDatabase(raw.DATABASE_URL_OWNER, database),
    DATABASE_URL_APP: onDatabase(raw.DATABASE_URL_APP, database),
    DATABASE_URL_PLATFORM: onDatabase(raw.DATABASE_URL_PLATFORM, database),
  };
  const env = parseEnv({ ...raw, ...overrides });
  const { DATABASE_URL_OWNER } = parseMigrationEnv(overrides);
  return { ...env, DATABASE_URL_OWNER };
}
