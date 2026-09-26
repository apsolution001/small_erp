import {
  itemResponseSchema,
  paginated,
  taxRateResponseSchema,
  unitResponseSchema,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import { withAppConnection, withOwnerClient, withTenantConnection } from '../support/db.js';
import { createTenant, type TestTenant } from '../support/masters.js';

/** Every tenant table the masters tasks add (testing standard: isolation per tenant table). */
const TENANT_TABLES = ['item_categories', 'items', 'item_units', 'item_tax_rates'] as const;

/** Tables whose rows are history: ekaro_app may not update or delete them at all. */
const APPEND_ONLY = new Set(['item_tax_rates']);

async function seedCatalog(tenant: TestTenant): Promise<void> {
  const units = paginated(unitResponseSchema).parse(
    (await tenant.client.get('/units?pageSize=200').expect(200)).body,
  );
  const unit = (code: string) => units.data.find((u) => u.code === code)?.id;
  const slabs = paginated(taxRateResponseSchema).parse(
    (await tenant.client.get('/tax-rates?q=18').expect(200)).body,
  );
  const category = await tenant.client.post('/item-categories', { name: 'Steel' }).expect(201);
  itemResponseSchema.parse(
    (
      await tenant.client
        .post('/items', {
          code: 'TMT-8',
          name: 'TMT bar 8 mm',
          itemType: 'goods',
          itemKind: 'trading',
          hsnSac: '7214',
          categoryId: (category.body as { id: string }).id,
          baseUnitId: unit('KGS'),
          units: [{ unitId: unit('BAG'), factorToBase: '50' }],
          taxRateId: slabs.data[0]?.id,
        })
        .expect(201)
    ).body,
  );
}

describe('tenant isolation of the masters tables on a raw ekaro_app connection', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
    await Promise.all([seedCatalog(a), seedCatalog(b)]);
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

  it.each(TENANT_TABLES)('%s: forced RLS, tenant_isolation only, audit trigger', async (table) => {
    const config = await withOwnerClient(async (c) => {
      const { rows } = await c.query<{ forced: boolean; policies: string[]; audited: boolean }>(
        `select c.relrowsecurity and c.relforcerowsecurity as forced,
                array(select policyname::text from pg_policies p where p.tablename = c.relname order by 1) as policies,
                exists(select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'audit_row_change') as audited
           from pg_class c where c.relname = $1`,
        [table],
      );
      return rows[0];
    });
    expect(config).toEqual({ forced: true, policies: ['tenant_isolation'], audited: true });
  });

  it.each(TENANT_TABLES)(
    "%s: B's context sees none of A's rows; no context sees none",
    async (table) => {
      expect(await count(a.tenantId, table)).toBeGreaterThan(0);
      expect(await count(b.tenantId, table, `tenant_id = '${a.tenantId}'`)).toBe(0);
      expect(await count(null, table)).toBe(0);
    },
  );

  it.each(TENANT_TABLES.filter((t) => !APPEND_ONLY.has(t)))(
    "%s: B cannot update or delete A's rows (0 rows affected)",
    async (table) => {
      const before = await count(a.tenantId, table);
      const affected = await withTenantConnection(b.tenantId, async (c) => {
        const updated = await c.query(
          `update ${table} set version = version where tenant_id = $1`,
          [a.tenantId],
        );
        const deleted = await c.query(`delete from ${table} where tenant_id = $1`, [a.tenantId]);
        return [updated.rowCount, deleted.rowCount];
      });
      expect(affected).toEqual([0, 0]);
      expect(await count(a.tenantId, table)).toBe(before);
    },
  );

  it("cannot point B's item at A's unit or category (composite tenant foreign keys)", async () => {
    const [aUnit] = await withTenantConnection(
      a.tenantId,
      async (c) => (await c.query<{ id: string }>(`select id from units where code = 'KGS'`)).rows,
    );
    await expect(
      withTenantConnection(b.tenantId, (c) =>
        c.query(
          `insert into items (id, code, name, item_type, item_kind, hsn_sac, base_unit_id)
           values (gen_random_uuid(), 'LEAK', 'Leak', 'goods', 'trading', '7214', $1)`,
          [aUnit?.id],
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint "items_base_unit_fk"/);
  });
});
