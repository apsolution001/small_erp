import { uuidv7 } from '@ekaro/core';
import { sql } from 'drizzle-orm';
import { type Tenant } from '../../src/modules/platform/tenants/tenants.schema.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTenant } from '../factories/tenants.js';
import {
  createProbeTable,
  dropTable,
  testPlatformDb,
  withAppConnection,
  withOwnerClient,
  withTenantConnection,
} from '../support/db.js';

interface ProbeRow {
  id: string;
  tenant_id: string;
  name: string;
  qty: number;
}

interface AuditRow {
  tenant_id: string;
  table_name: string;
  row_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  request_id: string | null;
}

const RLS_VIOLATION = /new row violates row-level security policy/;
const PERMISSION_DENIED = /permission denied/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('tenant isolation on a raw ekaro_app connection (RLS)', () => {
  let table: string;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let rowA1: ProbeRow;

  const insert = (tenantId: string, name: string, qty = 0) =>
    withTenantConnection(tenantId, async (c) => {
      const { rows } = await c.query<ProbeRow>(
        `insert into ${table} (name, qty) values ($1, $2) returning *`,
        [name, qty],
      );
      return rows[0]!;
    });

  const namesVisibleTo = (tenantId: string | null) =>
    withAppConnection({ tenantId }, async (c) => {
      const { rows } = await c.query<{ name: string }>(`select name from ${table} order by name`);
      return rows.map((r) => r.name);
    });

  beforeAll(async () => {
    table = await createProbeTable();
    [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
    rowA1 = await insert(tenantA.id, 'a1', 1);
    await insert(tenantA.id, 'a2', 2);
    await insert(tenantB.id, 'b1', 3);
  });

  afterAll(async () => {
    await dropTable(table);
  });

  it('returns 0 rows without a tenant context (fail closed)', async () => {
    expect(await namesVisibleTo(null)).toEqual([]);
    const count = await withAppConnection({}, (c) =>
      c.query(`select count(*)::int as n from ${table}`),
    );
    expect(count.rows).toEqual([{ n: 0 }]);
  });

  it('returns only the rows of the tenant in context', async () => {
    expect(await namesVisibleTo(tenantA.id)).toEqual(['a1', 'a2']);
    expect(await namesVisibleTo(tenantB.id)).toEqual(['b1']);
  });

  it('fills tenant_id from the context when the insert omits it', () => {
    expect(rowA1.tenant_id).toBe(tenantA.id);
  });

  it('rejects an insert that names another tenant (with check)', async () => {
    await expect(
      withTenantConnection(tenantA.id, (c) =>
        c.query(`insert into ${table} (tenant_id, name) values ($1, 'smuggled')`, [tenantB.id]),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
    expect(await namesVisibleTo(tenantB.id)).toEqual(['b1']);
  });

  it('rejects an insert without a tenant context', async () => {
    // tenant_id defaults to app_current_tenant(), NULL here: the policy check rejects it first.
    await expect(
      withAppConnection({}, (c) => c.query(`insert into ${table} (name) values ('orphan')`)),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it("cannot update or delete another tenant's rows (0 rows affected)", async () => {
    const affected = await withTenantConnection(tenantB.id, async (c) => {
      const updated = await c.query(`update ${table} set name = 'hacked' where id = $1`, [
        rowA1.id,
      ]);
      const deleted = await c.query(`delete from ${table} where id = $1`, [rowA1.id]);
      return [updated.rowCount, deleted.rowCount];
    });
    expect(affected).toEqual([0, 0]);
    expect(await namesVisibleTo(tenantA.id)).toEqual(['a1', 'a2']);
  });

  it('cannot move its own row to another tenant', async () => {
    await expect(
      withTenantConnection(tenantA.id, (c) =>
        c.query(`update ${table} set tenant_id = $1 where id = $2`, [tenantB.id, rowA1.id]),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('lets ekaro_app see only its own tenants row', async () => {
    const visible = (tenantId: string | null) =>
      withAppConnection({ tenantId }, async (c) => {
        const { rows } = await c.query<{ id: string }>('select id from tenants');
        return rows.map((r) => r.id);
      });
    expect(await visible(tenantA.id)).toEqual([tenantA.id]);
    expect(await visible(null)).toEqual([]);
    await expect(
      withTenantConnection(tenantA.id, (c) =>
        c.query(`update tenants set plan = 'pro' where id = $1`, [tenantA.id]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe('audit trigger', () => {
  let table: string;
  let tenantA: Tenant;
  let tenantB: Tenant;
  const userA = uuidv7();

  const auditRowsFor = (tenantId: string, rowId: string) =>
    withTenantConnection(tenantId, async (c) => {
      const { rows } = await c.query<AuditRow>(
        `select tenant_id, table_name, row_id, action, old_data, new_data, changed_by, request_id
           from audit_log where table_name = $1 and row_id = $2 order by changed_at, action`,
        [table, rowId],
      );
      return rows;
    });

  beforeAll(async () => {
    table = await createProbeTable('test_audit_probe');
    [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  });

  afterAll(async () => {
    await dropTable(table);
  });

  it('writes old and new values, the action, the user and the request id', async () => {
    const as = (requestId: string) => ({ userId: userA, requestId });
    const row = await withTenantConnection(
      tenantA.id,
      async (c) => {
        const { rows } = await c.query<ProbeRow>(
          `insert into ${table} (name, qty) values ('widget', 1) returning *`,
        );
        return rows[0]!;
      },
      as('req-insert'),
    );
    await withTenantConnection(
      tenantA.id,
      (c) => c.query(`update ${table} set qty = 2 where id = $1`, [row.id]),
      as('req-update'),
    );
    await withTenantConnection(
      tenantA.id,
      (c) => c.query(`delete from ${table} where id = $1`, [row.id]),
      as('req-delete'),
    );

    const v1 = { id: row.id, tenant_id: tenantA.id, name: 'widget', qty: 1 };
    const v2 = { ...v1, qty: 2 };
    const common = { tenant_id: tenantA.id, table_name: table, row_id: row.id, changed_by: userA };
    expect(await auditRowsFor(tenantA.id, row.id)).toEqual([
      { ...common, action: 'INSERT', old_data: null, new_data: v1, request_id: 'req-insert' },
      { ...common, action: 'UPDATE', old_data: v1, new_data: v2, request_id: 'req-update' },
      { ...common, action: 'DELETE', old_data: v2, new_data: null, request_id: 'req-delete' },
    ]);
  });

  it('records a NULL user for system writes without a user', async () => {
    const row = await withTenantConnection(tenantA.id, async (c) => {
      const { rows } = await c.query<ProbeRow>(
        `insert into ${table} (name) values ('job') returning *`,
      );
      return rows[0]!;
    });
    const [audit] = await auditRowsFor(tenantA.id, row.id);
    expect(audit).toMatchObject({ action: 'INSERT', changed_by: null });
  });

  it('writes no audit row for an update that changes nothing', async () => {
    const row = await withTenantConnection(tenantA.id, async (c) => {
      const { rows } = await c.query<ProbeRow>(
        `insert into ${table} (name) values ('same') returning *`,
      );
      return rows[0]!;
    });
    const updated = await withTenantConnection(tenantA.id, (c) =>
      c.query(`update ${table} set name = name, qty = qty where id = $1`, [row.id]),
    );
    expect(updated.rowCount).toBe(1);
    expect((await auditRowsFor(tenantA.id, row.id)).map((r) => r.action)).toEqual(['INSERT']);
  });

  it('keeps audit rows tenant-isolated and append-only for ekaro_app', async () => {
    const row = await withTenantConnection(tenantA.id, async (c) => {
      const { rows } = await c.query<ProbeRow>(
        `insert into ${table} (name) values ('secret') returning *`,
      );
      return rows[0]!;
    });
    expect(await auditRowsFor(tenantB.id, row.id)).toEqual([]);
    await expect(
      withTenantConnection(tenantA.id, (c) =>
        c.query(`update audit_log set changed_by = null where row_id = $1`, [row.id]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      withTenantConnection(tenantA.id, (c) =>
        c.query(`delete from audit_log where row_id = $1`, [row.id]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      withTenantConnection(tenantA.id, (c) =>
        c.query(
          `insert into audit_log (tenant_id, table_name, action, new_data) values ($1, 'x', 'INSERT', '{}')`,
          [tenantB.id],
        ),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('does not expose partitions directly (only the RLS-protected parent)', async () => {
    const partition = await withOwnerClient(async (c) => {
      const { rows } = await c.query<{ name: string }>(
        `select inhrelid::regclass::text as name from pg_inherits
          where inhparent = 'audit_log'::regclass order by 1 limit 1`,
      );
      return rows[0]!.name;
    });
    await expect(
      withTenantConnection(tenantA.id, (c) => c.query(`select * from ${partition}`)),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe('tenancy SQL helpers', () => {
  it('app_uuidv7() produces version-7 ids', async () => {
    const { rows } = await withAppConnection({}, (c) =>
      c.query<{ id: string }>('select app_uuidv7()::text as id from generate_series(1, 3)'),
    );
    for (const { id } of rows) expect(id).toMatch(UUID_V7);
  });

  it('app_enable_tenant_table() is idempotent: one policy, one trigger', async () => {
    const table = await createProbeTable('test_idem_probe');
    try {
      const counts = await withOwnerClient(async (c) => {
        await c.query('select app_enable_tenant_table($1::regclass)', [table]);
        const { rows } = await c.query<{ policies: number; triggers: number; forced: boolean }>(
          `select (select count(*)::int from pg_policies where tablename = $1) as policies,
                  (select count(*)::int from pg_trigger where tgrelid = $1::regclass and not tgisinternal) as triggers,
                  (select relforcerowsecurity from pg_class where oid = $1::regclass) as forced`,
          [table],
        );
        return rows[0];
      });
      expect(counts).toEqual({ policies: 1, triggers: 1, forced: true });
    } finally {
      await dropTable(table);
    }
  });

  it('app_enable_tenant_table() refuses a table without "tenant_id uuid not null"', async () => {
    const table = `test_no_tenant_${uuidv7().replaceAll('-', '').slice(-12)}`;
    await withOwnerClient((c) =>
      c.query(`create table ${table} (id uuid primary key, tenant_id uuid)`),
    );
    try {
      await expect(
        withOwnerClient((c) => c.query('select app_enable_tenant_table($1::regclass)', [table])),
      ).rejects.toThrow(/must have a "tenant_id uuid not null" column/);
    } finally {
      await dropTable(table);
    }
  });

  it('keeps the table helpers owner-only', async () => {
    await expect(
      withAppConnection({}, (c) => c.query(`select app_enable_tenant_table('tenants'::regclass)`)),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      withAppConnection({}, (c) => c.query(`select app_grant_platform_read('tenants'::regclass)`)),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it('app_ensure_audit_partitions() keeps 12 months ahead and is idempotent (callable by the job role)', async () => {
    const created = await withAppConnection({}, (c) =>
      c.query<{ created: number }>('select app_ensure_audit_partitions(12) as created'),
    );
    expect(created.rows).toEqual([{ created: 0 }]);
    const { rows } = await withOwnerClient((c) =>
      c.query<{ upper: Date }>(
        `select max(to_date(right(inhrelid::regclass::text, 7), 'YYYY_MM')) as upper
           from pg_inherits where inhparent = 'audit_log'::regclass`,
      ),
    );
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1));
    expect(rows[0]!.upper.getFullYear()).toBe(expected.getUTCFullYear());
    expect(rows[0]!.upper.getMonth()).toBe(expected.getUTCMonth());
  });

  it('app_grant_platform_read() lets ekaro_platform read every tenant, and nothing more', async () => {
    const table = await createProbeTable('test_platform_probe');
    try {
      const [a, b] = await Promise.all([createTestTenant(), createTestTenant()]);
      await withTenantConnection(a.id, (c) => c.query(`insert into ${table} (name) values ('a')`));
      await withTenantConnection(b.id, (c) => c.query(`insert into ${table} (name) values ('b')`));
      const platform = testPlatformDb();
      await expect(platform.execute(sql.raw(`select name from ${table}`))).rejects.toMatchObject({
        cause: { message: expect.stringMatching(PERMISSION_DENIED) as string },
      });

      await withOwnerClient((c) =>
        c.query('select app_grant_platform_read($1::regclass)', [table]),
      );
      const { rows } = await platform.execute<{ name: string }>(
        sql.raw(
          `select name from ${table} where tenant_id in ('${a.id}', '${b.id}') order by name`,
        ),
      );
      expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
      await expect(
        platform.execute(sql.raw(`insert into ${table} (tenant_id, name) values ('${a.id}', 'x')`)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(PERMISSION_DENIED) as string },
      });
    } finally {
      await dropTable(table);
    }
  });
});
