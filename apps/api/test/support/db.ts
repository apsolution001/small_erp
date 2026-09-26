import { uuidv7 } from '@ekaro/core';
import pg from 'pg';
import { createPlatformDb, type PlatformDb } from '../../src/infra/db/platform-db.js';
import { loadTestEnv } from './test-env.js';

/**
 * Raw connections to the test database, one pool per role, for fixtures and RLS assertions
 * that must not go through the code under test. Closed by `setup-file.ts` after each file.
 */
type Role = 'owner' | 'app' | 'platform';

const pools = new Map<Role, pg.Pool>();

function pool(role: Role): pg.Pool {
  let existing = pools.get(role);
  if (existing === undefined) {
    const env = loadTestEnv();
    const url = {
      owner: env.DATABASE_URL_OWNER,
      app: env.DATABASE_URL_APP,
      platform: env.DATABASE_URL_PLATFORM,
    }[role];
    existing = new pg.Pool({
      connectionString: url,
      max: 4,
      application_name: `ekaro-test-${role}`,
    });
    pools.set(role, existing);
  }
  return existing;
}

export async function closeTestPools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.end()));
}

/** DDL and fixtures as `ekaro_owner` (subject to FORCE RLS like everyone else). */
export async function withOwnerClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool('owner').connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Drizzle on the `ekaro_platform` role, as modules/platform and modules/auth use it. */
export function testPlatformDb(): PlatformDb {
  return createPlatformDb(pool('platform'));
}

export interface TxContext {
  readonly tenantId?: string | null;
  readonly userId?: string | null;
  readonly requestId?: string | null;
}

/**
 * Runs `fn` on a raw `ekaro_app` connection inside one transaction that first sets the given
 * context exactly like the API does (transaction-local `set_config`). Commits on success, rolls
 * back on error. With no tenant, nothing is set: the connection sees what an unscoped query sees.
 */
export async function withAppConnection<T>(
  context: TxContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool('app').connect();
  try {
    await client.query('begin');
    const tenantId = context.tenantId ?? null;
    if (tenantId !== null) {
      await client.query(
        `select set_config('app.tenant_id', $1, true),
                set_config('app.user_id', $2, true),
                set_config('app.request_id', $3, true)`,
        [tenantId, context.userId ?? '', context.requestId ?? uuidv7()],
      );
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** {@link withAppConnection} as `tenantId` (the RLS test helper, a.k.a. `asTenant`). */
export function withTenantConnection<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  context: Omit<TxContext, 'tenantId'> = {},
): Promise<T> {
  return withAppConnection({ ...context, tenantId }, fn);
}

/**
 * A throwaway tenant table, created as owner and enabled with `app_enable_tenant_table` exactly
 * as a real migration would. Returns its (unique) name; drop it with {@link dropTable}.
 */
export async function createProbeTable(prefix = 'test_rls_probe'): Promise<string> {
  const name = `${prefix}_${uuidv7().replaceAll('-', '').slice(-12)}`;
  await withOwnerClient(async (client) => {
    await client.query(`
      create table ${name} (
        id uuid primary key default app_uuidv7(),
        tenant_id uuid not null default app_current_tenant() references tenants (id),
        name text not null,
        qty integer not null default 0
      )`);
    await client.query('select app_enable_tenant_table($1::regclass)', [name]);
  });
  return name;
}

export async function dropTable(name: string): Promise<void> {
  await withOwnerClient((client) => client.query(`drop table if exists ${name}`));
}
