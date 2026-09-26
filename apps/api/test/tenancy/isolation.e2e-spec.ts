import { type NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashOpaqueToken, newOpaqueToken } from '../../src/common/crypto/opaque-token.js';
import { addMembership, createTestUser } from '../factories/users.js';
import { createTestApp } from '../support/app.js';
import { type SignedUp, signUp } from '../support/auth.js';
import {
  testPlatformDb,
  withAppConnection,
  withOwnerClient,
  withTenantConnection,
} from '../support/db.js';

/** Every audited tenant table of T-104 and T-105 (testing standard: an isolation test each). */
const TENANT_TABLES = [
  'roles',
  'memberships',
  'membership_branches',
  'company_profile',
  'branches',
  'godowns',
  'units',
  'tax_rates',
  'document_series',
  'invitations',
] as const;

/** Tables ekaro_platform may read across tenants (login, sessions, invitation acceptance). */
const PLATFORM_READABLE = [
  'roles',
  'memberships',
  'membership_branches',
  'company_profile',
  'invitations',
];

const randomTokenHash = () => hashOpaqueToken(newOpaqueToken());

/** Business-rule triggers some tables carry besides the audit trigger (T-106, T-107). */
const GUARD_TRIGGERS: Partial<Record<(typeof TENANT_TABLES)[number], string[]>> = {
  tax_rates: ['tax_rates_rates_immutable'],
  document_series: ['document_series_numbering_guard'],
};

const RLS_VIOLATION = /new row violates row-level security policy/;
const PERMISSION_DENIED = /permission denied/;

describe('tenant isolation of the tenant tables on a raw ekaro_app connection', () => {
  let app: NestExpressApplication;
  let a: SignedUp;
  let b: SignedUp;
  let aStoreUserId = '';

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([signUp(app), signUp(app)]);
    // Give tenant A a branch-scoped membership, so membership_branches has a row to protect.
    const [ho] = await withTenantConnection(a.body.tenant.id, async (c) =>
      (await c.query<{ id: string }>('select id from branches where is_head_office')).rows.map(
        (r) => r.id,
      ),
    );
    const user = await createTestUser();
    aStoreUserId = user.id;
    await addMembership(a.body.tenant.id, user.id, 'Store', { branchIds: [ho ?? ''] });
    // And a pending invitation, so invitations has a row to protect.
    await withTenantConnection(a.body.tenant.id, (c) =>
      c.query(
        `insert into invitations (id, email, role_id, token_hash, expires_at)
         select $1, 'invitee@example.com', id, $2, now() + interval '7 days'
           from roles where name = 'Sales'`,
        [crypto.randomUUID(), randomTokenHash()],
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const count = (tenantId: string | null, table: string, where = 'true') =>
    withAppConnection({ tenantId }, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from ${table} where ${where}`,
      );
      return rows[0]?.n;
    });

  it.each(TENANT_TABLES)(
    '%s: forced RLS with the tenant_isolation policy and audit trigger',
    async (table) => {
      const config = await withOwnerClient(async (c) => {
        const { rows } = await c.query<{ forced: boolean; policies: string[]; triggers: string[] }>(
          `select c.relrowsecurity and c.relforcerowsecurity as forced,
                array(select policyname::text from pg_policies p where p.tablename = c.relname order by 1) as policies,
                array(select tgname::text from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal order by 1) as triggers
           from pg_class c where c.relname = $1`,
          [table],
        );
        return rows[0];
      });
      expect(config).toEqual({
        forced: true,
        policies: PLATFORM_READABLE.includes(table)
          ? ['platform_read', 'tenant_isolation']
          : ['tenant_isolation'],
        triggers: ['audit_row_change', ...(GUARD_TRIGGERS[table] ?? [])],
      });
    },
  );

  it.each(TENANT_TABLES)(
    "%s: B's context sees none of A's rows, and A sees its own",
    async (table) => {
      const own = await count(a.body.tenant.id, table);
      expect(own).toBeGreaterThan(0);
      expect(await count(b.body.tenant.id, table, `tenant_id = '${a.body.tenant.id}'`)).toBe(0);
      expect(await count(null, table)).toBe(0);
    },
  );

  it.each(TENANT_TABLES)(
    "%s: B cannot update or delete A's rows (0 rows affected)",
    async (table) => {
      const before = await count(a.body.tenant.id, table);
      const affected = await withTenantConnection(b.body.tenant.id, async (c) => {
        const updated = await c.query(
          `update ${table} set tenant_id = tenant_id where tenant_id = $1`,
          [a.body.tenant.id],
        );
        const deleted = await c.query(`delete from ${table} where tenant_id = $1`, [
          a.body.tenant.id,
        ]);
        return [updated.rowCount, deleted.rowCount];
      });
      expect(affected).toEqual([0, 0]);
      expect(await count(a.body.tenant.id, table)).toBe(before);
    },
  );

  it("B cannot insert rows into A's tenant", async () => {
    await expect(
      withTenantConnection(b.body.tenant.id, (c) =>
        c.query(
          `insert into units (id, tenant_id, code, name, uqc) values ($1, $2, 'X', 'X', 'NOS')`,
          [crypto.randomUUID(), a.body.tenant.id],
        ),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it("cannot point a B row at A's branch (composite tenant foreign keys)", async () => {
    const [aBranch] = await withTenantConnection(
      a.body.tenant.id,
      async (c) => (await c.query<{ id: string }>('select id from branches')).rows,
    );
    await expect(
      withTenantConnection(b.body.tenant.id, (c) =>
        c.query(`insert into godowns (id, branch_id, code, name) values ($1, $2, 'G2', 'Leak')`, [
          crypto.randomUUID(),
          aBranch?.id,
        ]),
      ),
    ).rejects.toThrow(/violates foreign key constraint "godowns_branch_fk"/);
  });

  it('keeps sessions, refresh tokens and every private column of users out of reach of ekaro_app', async () => {
    for (const table of ['sessions', 'refresh_tokens']) {
      await expect(
        withTenantConnection(a.body.tenant.id, (c) => c.query(`select count(*) from ${table}`)),
        table,
      ).rejects.toThrow(PERMISSION_DENIED);
    }
    for (const query of [
      'select * from users',
      'select password_hash from users',
      'select totp_secret_enc from users',
      'select email_verified_at, last_login_at from users',
    ]) {
      await expect(
        withTenantConnection(a.body.tenant.id, (c) => c.query(query)),
        query,
      ).rejects.toThrow(PERMISSION_DENIED);
    }
    for (const statement of [
      `update users set full_name = 'x'`,
      `insert into users (email, full_name) values ('x@example.com', 'x')`,
      'delete from users',
    ]) {
      await expect(
        withTenantConnection(a.body.tenant.id, (c) => c.query(statement)),
        statement,
      ).rejects.toThrow(PERMISSION_DENIED);
    }
  });

  it("shows ekaro_app exactly the tenant's own members in the user directory (ADR 0017)", async () => {
    const directory = (tenantId: string | null) =>
      withAppConnection({ tenantId }, async (c) =>
        (
          await c.query<{ id: string; email: string }>(
            'select id, email, full_name, mobile, status from tenant_users order by email',
          )
        ).rows.map((r) => r.id),
      );
    expect((await directory(a.body.tenant.id)).sort()).toEqual(
      [a.body.user.id, aStoreUserId].sort(),
    );
    expect(await directory(b.body.tenant.id)).toEqual([b.body.user.id]);
    expect(await directory(null)).toEqual([]);
    // The same rule on the table itself (the view adds no privilege: security_invoker).
    const direct = await withTenantConnection(
      b.body.tenant.id,
      async (c) =>
        (
          await c.query<{ n: number }>('select count(*)::int as n from users where id = $1', [
            aStoreUserId,
          ])
        ).rows,
    );
    expect(direct).toEqual([{ n: 0 }]);
  });

  it('outbox: forced RLS, no audit trigger, insert-only for ekaro_app, own tenant only', async () => {
    const config = await withOwnerClient(async (c) => {
      const { rows } = await c.query<{ forced: boolean; policies: string[]; triggers: string[] }>(
        `select c.relrowsecurity and c.relforcerowsecurity as forced,
                array(select policyname::text from pg_policies p where p.tablename = c.relname order by 1) as policies,
                array(select tgname::text from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
           from pg_class c where c.relname = 'outbox'`,
      );
      return rows[0];
    });
    expect(config).toEqual({ forced: true, policies: ['tenant_isolation'], triggers: [] });

    const payload = JSON.stringify({ probe: true });
    await withTenantConnection(a.body.tenant.id, (c) =>
      c.query(`insert into outbox (id, topic, payload) values ($1, 'email.user_invitation', $2)`, [
        crypto.randomUUID(),
        payload,
      ]),
    );
    await expect(
      withTenantConnection(b.body.tenant.id, (c) =>
        c.query(
          `insert into outbox (id, tenant_id, topic, payload) values ($1, $2, 'email.user_invitation', $3)`,
          [crypto.randomUUID(), a.body.tenant.id, payload],
        ),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
    for (const statement of [
      'select count(*) from outbox',
      `update outbox set attempts = 1`,
      'delete from outbox',
    ]) {
      await expect(
        withTenantConnection(a.body.tenant.id, (c) => c.query(statement)),
        statement,
      ).rejects.toThrow(PERMISSION_DENIED);
    }
    const rows = await withOwnerClient(async (c) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [a.body.tenant.id]);
      const { rows: found } = await c.query<{ tenant_id: string; created_by: string | null }>(
        `select tenant_id, created_by from outbox where payload = $1::jsonb`,
        [payload],
      );
      await c.query('commit');
      return found;
    });
    expect(rows).toEqual([{ tenant_id: a.body.tenant.id, created_by: null }]);
  });

  it('lets ekaro_platform read memberships of every tenant (login), but only the context tenant elsewhere', async () => {
    const platform = testPlatformDb();
    const ids = `('${a.body.tenant.id}', '${b.body.tenant.id}')`;
    const memberships = await platform.execute<{ n: number }>(
      sql.raw(
        `select count(distinct tenant_id)::int as n from memberships where tenant_id in ${ids}`,
      ),
    );
    expect(memberships.rows).toEqual([{ n: 2 }]);
    // branches: SELECT for the bootstrap's read-back, limited by RLS to the tenant in context.
    const branches = await platform.execute<{ n: number }>(
      sql.raw(`select count(*)::int as n from branches where tenant_id in ${ids}`),
    );
    expect(branches.rows).toEqual([{ n: 0 }]);
    await expect(
      platform.execute(sql.raw(`delete from branches where tenant_id in ${ids}`)),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(PERMISSION_DENIED) as string },
    });
  });

  it('gives ekaro_platform no read access to the masters the bootstrap only inserts', async () => {
    const platform = testPlatformDb();
    for (const table of ['godowns', 'units', 'tax_rates', 'document_series']) {
      await expect(
        platform.execute(sql.raw(`select count(*) from ${table}`)),
        table,
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(PERMISSION_DENIED) as string },
      });
    }
  });
});
