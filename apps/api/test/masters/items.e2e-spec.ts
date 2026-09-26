import {
  itemResponseSchema,
  itemTaxRateResponseSchema,
  paginated,
  taxRateResponseSchema,
  unitResponseSchema,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp } from '../support/app.js';
import { withTenantConnection } from '../support/db.js';
import {
  auditTrail,
  createTenant,
  errorPaths,
  expectProblem,
  rolesFor,
  type TestTenant,
} from '../support/masters.js';

const itemPage = paginated(itemResponseSchema);
const unitPage = paginated(unitResponseSchema);
const slabPage = paginated(taxRateResponseSchema);
const rateRows = z.array(itemTaxRateResponseSchema);

interface Refs {
  units: Record<string, string>;
  slabs: Record<string, string>;
  booksBeginDate: string;
}

async function refsOf(tenant: TestTenant): Promise<Refs> {
  const units = unitPage.parse((await tenant.client.get('/units?pageSize=200').expect(200)).body);
  const slabs = slabPage.parse((await tenant.client.get('/tax-rates').expect(200)).body);
  const booksBeginDate = await withTenantConnection(tenant.tenantId, async (c) => {
    const { rows } = await c.query<{ d: string }>(
      'select books_begin_date::text as d from company_profile',
    );
    return rows[0]?.d ?? '';
  });
  return {
    units: Object.fromEntries(units.data.map((u) => [u.code, u.id])),
    slabs: Object.fromEntries(slabs.data.map((s) => [s.name, s.id])),
    booksBeginDate,
  };
}

/** The day after `date` (YYYY-MM-DD). */
const nextDay = (date: string, days = 1): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('items API (MS-02: UoM conversions, effective-dated GST)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;
  let refs: Refs;

  const tmt = () => ({
    code: 'TMT-8',
    name: 'TMT bar 8 mm',
    itemType: 'goods',
    itemKind: 'trading',
    hsnSac: '72142090',
    baseUnitId: refs.units.KGS,
    salesUnitId: refs.units.BAG,
    units: [{ unitId: refs.units.BAG, factorToBase: '50' }],
    reorderLevel: '10.125',
    standardSalesRate: '62.500000',
    trackBatches: true,
    trackExpiry: true,
    taxRateId: refs.slabs['GST 18%'],
  });

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
    refs = await refsOf(a);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create and read', () => {
    let id = '';

    it('creates an item with conversions and its first rate; decimals come back exactly', async () => {
      const res = await a.client.post('/items', tmt()).expect(201);
      const item = itemResponseSchema.parse(res.body);
      id = item.id;
      expect(item).toMatchObject({
        code: 'TMT-8',
        hsnSac: '72142090',
        baseUnitId: refs.units.KGS,
        salesUnitId: refs.units.BAG,
        purchaseUnitId: null,
        reorderLevel: '10.125000',
        reorderQty: null,
        standardSalesRate: '62.500000',
        trackBatches: true,
        trackExpiry: true,
        isActive: true,
        version: 1,
        units: [{ unitId: refs.units.BAG, factorToBase: '50.000000' }],
        taxRates: [{ taxRateId: refs.slabs['GST 18%'], effectiveFrom: refs.booksBeginDate }],
      });
      expect((await a.client.get(`/items/${id}`).expect(200)).body).toEqual(res.body);
    });

    it('round-trips a factor sent with its full scale unchanged', async () => {
      const res = await a.client
        .post('/items', {
          ...tmt(),
          code: 'TMT-10',
          units: [{ unitId: refs.units.BAG, factorToBase: '49.999999' }],
        })
        .expect(201);
      expect(itemResponseSchema.parse(res.body).units).toEqual([
        { unitId: refs.units.BAG, factorToBase: '49.999999' },
      ]);
    });

    it('searches code, name and HSN, filters by kind and type, and sorts', async () => {
      await a.client
        .post('/items', {
          code: 'SVC-FREIGHT',
          name: 'Freight charges',
          itemType: 'service',
          itemKind: 'service',
          hsnSac: '996511',
          baseUnitId: refs.units.OTH,
          taxRateId: refs.slabs['GST 5%'],
        })
        .expect(201);
      const byHsn = itemPage.parse((await a.client.get('/items?q=9965').expect(200)).body);
      expect(byHsn.data.map((i) => i.code)).toEqual(['SVC-FREIGHT']);
      const byName = itemPage.parse((await a.client.get('/items?q=tmt%20bar').expect(200)).body);
      expect(byName.data.map((i) => i.code)).toEqual(['TMT-10', 'TMT-8']);
      const services = itemPage.parse((await a.client.get('/items?type=service').expect(200)).body);
      expect(services.meta.total).toBe(1);
      const trading = itemPage.parse(
        (await a.client.get('/items?kind=trading&sort=code:desc').expect(200)).body,
      );
      expect(trading.data.map((i) => i.code)).toEqual(['TMT-8', 'TMT-10']);
      expect(trading.data[0]?.units).toEqual([
        { unitId: refs.units.BAG, factorToBase: '50.000000' },
      ]);
    });

    it('updates fields and replaces the conversions, auditing each change', async () => {
      const res = await a.client
        .patch(`/items/${id}`, {
          name: 'TMT bar 8 mm Fe 500',
          purchaseUnitId: refs.units.TON,
          units: [
            { unitId: refs.units.BAG, factorToBase: '25' },
            { unitId: refs.units.TON, factorToBase: '1000' },
          ],
          version: 1,
        })
        .expect(200);
      expect(itemResponseSchema.parse(res.body)).toMatchObject({
        name: 'TMT bar 8 mm Fe 500',
        purchaseUnitId: refs.units.TON,
        version: 2,
        units: [
          { unitId: refs.units.BAG, factorToBase: '25.000000' },
          { unitId: refs.units.TON, factorToBase: '1000.000000' },
        ],
      });
      expect(await auditTrail(a.tenantId, 'items', id)).toEqual([
        { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
        { action: 'UPDATE', changedBy: a.ownerUserId, oldVersion: 1, newVersion: 2 },
      ]);
      const unitAudit = await withTenantConnection(a.tenantId, async (c) => {
        const { rows } = await c.query<{ action: string; factor: string | null }>(
          `select action, new_data->>'factor_to_base' as factor from audit_log
            where table_name = 'item_units' and (new_data->>'item_id' = $1 or old_data->>'item_id' = $1)
            order by changed_at, id`,
          [id],
        );
        return rows;
      });
      expect(unitAudit).toEqual([
        { action: 'INSERT', factor: '50.000000' },
        { action: 'UPDATE', factor: '25.000000' },
        { action: 'INSERT', factor: '1000.000000' },
      ]);
    });

    it('validates the merged record and refuses a stale version', async () => {
      const merged = await a.client.patch(`/items/${id}`, { trackBatches: false, version: 2 });
      expect(errorPaths(merged)).toEqual(['trackExpiry']);
      const dropped = await a.client.patch(`/items/${id}`, { units: [], version: 2 });
      expect(errorPaths(dropped)).toEqual(['purchaseUnitId', 'salesUnitId']);
      expectProblem(
        await a.client.patch(`/items/${id}`, { name: 'Stale', version: 1 }),
        409,
        'VERSION_CONFLICT',
      );
    });

    it('deactivates on DELETE (204): the item stays readable, inactive', async () => {
      await a.client.delete(`/items/${id}`).expect(204);
      const item = itemResponseSchema.parse((await a.client.get(`/items/${id}`).expect(200)).body);
      expect(item).toMatchObject({ isActive: false, version: 3 });
      await a.client.delete(`/items/${id}`).expect(204);
      const inactive = itemPage.parse((await a.client.get('/items?active=false').expect(200)).body);
      expect(inactive.data.map((i) => i.id)).toEqual([id]);
    });

    it('keeps a used unit and slab from being deleted (409 IN_USE)', async () => {
      expectProblem(await a.client.delete(`/units/${refs.units.BAG}`), 409, 'IN_USE');
      expectProblem(await a.client.delete(`/units/${refs.units.KGS}`), 409, 'IN_USE');
      expectProblem(await a.client.delete(`/tax-rates/${refs.slabs['GST 18%']}`), 409, 'IN_USE');
    });
  });

  describe('rules that need other data', () => {
    it('refuses an HSN shorter than the company minimum', async () => {
      await withTenantConnection(a.tenantId, (c) =>
        c.query('update company_profile set hsn_min_digits = 6'),
      );
      try {
        const res = await a.client.post('/items', { ...tmt(), code: 'HSN-4', hsnSac: '7214' });
        expect(errorPaths(res)).toEqual(['hsnSac']);
        await a.client.post('/items', { ...tmt(), code: 'HSN-6', hsnSac: '721420' }).expect(201);
      } finally {
        await withTenantConnection(a.tenantId, (c) =>
          c.query('update company_profile set hsn_min_digits = 4'),
        );
      }
    });

    it('refuses an inactive unit or category, and a unit of another tenant', async () => {
      const crate = unitResponseSchema.parse(
        (await a.client.post('/units', { code: 'CRATE', name: 'Crate', uqc: 'OTH' }).expect(201))
          .body,
      );
      await a.client.patch(`/units/${crate.id}`, { isActive: false, version: 1 }).expect(200);
      const res = await a.client.post('/items', {
        ...tmt(),
        code: 'X-1',
        salesUnitId: crate.id,
        units: [{ unitId: crate.id, factorToBase: '12' }],
      });
      expect(errorPaths(res)).toEqual(['salesUnitId', 'units.0.unitId']);
      const category = await a.client.post('/item-categories', { name: 'Retired' }).expect(201);
      const categoryId = (category.body as { id: string }).id;
      await a.client
        .patch(`/item-categories/${categoryId}`, { isActive: false, version: 1 })
        .expect(200);
      const retired = await a.client.post('/items', { ...tmt(), code: 'X-4', categoryId });
      expect(errorPaths(retired)).toEqual(['categoryId']);
      const bRefs = await refsOf(b);
      const foreign = await b.client.post('/items', {
        ...tmt(),
        code: 'X-2',
        baseUnitId: refs.units.KGS,
        salesUnitId: null,
        units: [],
        taxRateId: bRefs.slabs['GST 18%'],
      });
      expect(errorPaths(foreign)).toEqual(['baseUnitId']);
      const foreignSlab = await b.client.post('/items', {
        ...tmt(),
        code: 'X-3',
        baseUnitId: bRefs.units.KGS,
        salesUnitId: null,
        units: [],
      });
      expect(errorPaths(foreignSlab)).toEqual(['taxRateId']);
    });

    it('validates fields (422) and refuses a duplicate code (409)', async () => {
      expect(
        errorPaths(await a.client.post('/items', { ...tmt(), code: 'Y', hsnSac: '72142' })),
      ).toEqual(['hsnSac']);
      expect(
        errorPaths(await a.client.post('/items', { ...tmt(), code: 'Y', trackBatches: false })),
      ).toEqual(['trackExpiry']);
      const { taxRateId: _omit, ...noRate } = tmt();
      expect(errorPaths(await a.client.post('/items', { ...noRate, code: 'Y' }))).toEqual([
        'taxRateId',
      ]);
      expectProblem(await a.client.post('/items', tmt()), 409, 'ALREADY_EXISTS');
    });
  });

  describe('effective-dated tax rates', () => {
    let id = '';
    let changeDate = '';

    beforeAll(async () => {
      id = itemResponseSchema.parse(
        (await a.client.post('/items', { ...tmt(), code: 'RATE-1' }).expect(201)).body,
      ).id;
      changeDate = nextDay(refs.booksBeginDate, 100);
    });

    it('adds a rate from a date (201) and lists the rows oldest first', async () => {
      const res = await a.client
        .post(`/items/${id}/tax-rates`, {
          taxRateId: refs.slabs['GST 5%'],
          effectiveFrom: changeDate,
        })
        .expect(201);
      expect(itemTaxRateResponseSchema.parse(res.body)).toMatchObject({
        taxRateId: refs.slabs['GST 5%'],
        effectiveFrom: changeDate,
      });
      const rows = rateRows.parse((await a.client.get(`/items/${id}/tax-rates`).expect(200)).body);
      expect(rows.map((r) => [r.taxRateId, r.effectiveFrom])).toEqual([
        [refs.slabs['GST 18%'], refs.booksBeginDate],
        [refs.slabs['GST 5%'], changeDate],
      ]);
      const trail = await auditTrail(
        a.tenantId,
        'item_tax_rates',
        itemTaxRateResponseSchema.parse(res.body).id,
      );
      expect(trail).toEqual([
        { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
      ]);
    });

    it('returns the slab in force on a date', async () => {
      const on = async (date: string) =>
        rateRows
          .parse((await a.client.get(`/items/${id}/tax-rates?on=${date}`).expect(200)).body)
          .map((r) => r.taxRateId);
      expect(await on(refs.booksBeginDate)).toEqual([refs.slabs['GST 18%']]);
      expect(await on(nextDay(changeDate, -1))).toEqual([refs.slabs['GST 18%']]);
      expect(await on(changeDate)).toEqual([refs.slabs['GST 5%']]);
      expect(await on(nextDay(changeDate, 365))).toEqual([refs.slabs['GST 5%']]);
      expect(await on(nextDay(refs.booksBeginDate, -1))).toEqual([]);
    });

    it('refuses a second rate on the same date (409) or before the books (422)', async () => {
      const again = { taxRateId: refs.slabs['GST 40%'], effectiveFrom: changeDate };
      expectProblem(await a.client.post(`/items/${id}/tax-rates`, again), 409, 'ALREADY_EXISTS');
      const early = {
        taxRateId: refs.slabs['GST 40%'],
        effectiveFrom: nextDay(refs.booksBeginDate, -1),
      };
      expect(errorPaths(await a.client.post(`/items/${id}/tax-rates`, early))).toEqual([
        'effectiveFrom',
      ]);
    });

    it('never lets ekaro_app edit or delete a rate row', async () => {
      for (const statement of [
        `update item_tax_rates set effective_from = effective_from + 1 where item_id = $1`,
        `delete from item_tax_rates where item_id = $1`,
      ]) {
        await expect(
          withTenantConnection(a.tenantId, (c) => c.query(statement, [id])),
        ).rejects.toThrow(/permission denied/);
      }
    });

    it('guards the rate endpoints with their own permissions', async () => {
      const view = rolesFor('masters.item_tax_rate:view');
      await (await a.as(view.allowed)).get(`/items/${id}/tax-rates`).expect(200);
      expectProblem(
        await (await a.as(view.denied)).get(`/items/${id}/tax-rates`),
        403,
        'FORBIDDEN',
      );
      const create = rolesFor('masters.item_tax_rate:create');
      const body = { taxRateId: refs.slabs['GST 3%'], effectiveFrom: nextDay(changeDate, 30) };
      expectProblem(
        await (await a.as(create.denied)).post(`/items/${id}/tax-rates`, body),
        403,
        'FORBIDDEN',
      );
      await (await a.as(create.allowed)).post(`/items/${id}/tax-rates`, body).expect(201);
    });
  });

  it('allows and denies the item endpoints by permission', async () => {
    const view = rolesFor('masters.item:view');
    await (await a.as(view.allowed)).get('/items').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/items'), 403, 'FORBIDDEN');
    const create = rolesFor('masters.item:create');
    const body = { ...tmt(), code: 'PERM-1' };
    expectProblem(await (await a.as(create.denied)).post('/items', body), 403, 'FORBIDDEN');
    const item = itemResponseSchema.parse(
      (await (await a.as(create.allowed)).post('/items', body).expect(201)).body,
    );
    const edit = rolesFor('masters.item:edit');
    const patch = { name: 'Renamed', version: 1 };
    expectProblem(
      await (await a.as(edit.denied)).patch(`/items/${item.id}`, patch),
      403,
      'FORBIDDEN',
    );
    await (await a.as(edit.allowed)).patch(`/items/${item.id}`, patch).expect(200);
    const del = rolesFor('masters.item:delete');
    expectProblem(await (await a.as(del.denied)).delete(`/items/${item.id}`), 403, 'FORBIDDEN');
    await (await a.as(del.allowed)).delete(`/items/${item.id}`).expect(204);
  });

  it("keeps each tenant's items to itself", async () => {
    const [aItem] = itemPage.parse((await a.client.get('/items?q=TMT-8').expect(200)).body).data;
    const id = aItem?.id ?? '';
    expectProblem(await b.client.get(`/items/${id}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/items/${id}`, { name: 'x', version: 3 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await b.client.delete(`/items/${id}`), 404, 'NOT_FOUND');
    expectProblem(await b.client.get(`/items/${id}/tax-rates`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.post(`/items/${id}/tax-rates`, {
        taxRateId: refs.slabs['GST 5%'],
        effectiveFrom: refs.booksBeginDate,
      }),
      404,
      'NOT_FOUND',
    );
    expect(itemPage.parse((await b.client.get('/items').expect(200)).body).meta.total).toBe(0);
  });
});
