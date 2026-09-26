import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uuidv7 } from '@ekaro/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/infra/db/migrator.js';
import { withOwnerClient } from '../support/db.js';
import { loadTestEnv } from '../support/test-env.js';

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as { entries: { tag: string }[] };

/** A brand-new database owned by ekaro_owner (which has CREATEDB), dropped afterwards. */
describe('migrations on an empty database', () => {
  const database = `${loadTestEnv().DATABASE_URL_OWNER.split('/').pop()!}_fresh_${uuidv7().slice(-8)}`;
  let url: string;

  const query = async <T extends pg.QueryResultRow>(text: string): Promise<T[]> => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<T>(text)).rows;
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    await withOwnerClient((c) => c.query(`create database "${database}"`));
    const parsed = new URL(loadTestEnv().DATABASE_URL_OWNER);
    parsed.pathname = `/${database}`;
    url = parsed.toString();
  });

  afterAll(async () => {
    await withOwnerClient((c) => c.query(`drop database if exists "${database}" with (force)`));
  });

  it('applies every migration once, and a second run is a no-op', async () => {
    await runMigrations(url);
    const applied = await query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(applied).toEqual([{ n: journal.entries.length }]);

    await runMigrations(url);
    expect(
      await query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations'),
    ).toEqual([{ n: journal.entries.length }]);
  });

  it('leaves every object owned by ekaro_owner, with RLS forced on every table', async () => {
    const owners = await query<{ owner: string }>(
      `select distinct pg_get_userbyid(relowner) as owner from pg_class
        where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'i', 'I', 'S', 'v')`,
    );
    expect(owners).toEqual([{ owner: 'ekaro_owner' }]);
    const unprotected = await query<{ relname: string }>(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
          and not relispartition and not (relrowsecurity and relforcerowsecurity)
        order by relname`,
    );
    expect(unprotected).toEqual([]);
    const tables = await query<{ n: number }>(
      `select count(*)::int as n from pg_class
        where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relispartition`,
    );
    // tenants, audit_log, users, sessions, refresh_tokens and the nine T-104 tenant tables.
    expect(tables).toEqual([{ n: 14 }]);
  });

  it('creates audit partitions for the current month and 12 months ahead', async () => {
    const partitions = await query<{ n: number }>(
      `select count(*)::int as n from pg_inherits where inhparent = 'audit_log'::regclass`,
    );
    expect(partitions).toEqual([{ n: 13 }]);
  });
});
