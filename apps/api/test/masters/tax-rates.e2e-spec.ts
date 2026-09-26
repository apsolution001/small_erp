import { paginated, taxRateResponseSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const slabPage = paginated(taxRateResponseSchema);

describe('tax rates API (spec 02: slabs immutable in their rates)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded slabs by rate, with exact numeric(7,4) strings', async () => {
    const page = slabPage.parse((await a.client.get('/tax-rates').expect(200)).body);
    expect(page.meta.total).toBe(10);
    expect(page.data.map((s) => [s.name, s.gstRate, s.cessRate, s.isActive])).toEqual([
      ['Nil Rated', '0.0000', '0.0000', true],
      ['Exempt', '0.0000', '0.0000', true],
      ['GST 0.25%', '0.2500', '0.0000', true],
      ['GST 1.5%', '1.5000', '0.0000', true],
      ['GST 3%', '3.0000', '0.0000', true],
      ['GST 5%', '5.0000', '0.0000', true],
      ['GST 12%', '12.0000', '0.0000', false],
      ['GST 18%', '18.0000', '0.0000', true],
      ['GST 28%', '28.0000', '0.0000', false],
      ['GST 40%', '40.0000', '0.0000', true],
    ]);
    const active = slabPage.parse((await a.client.get('/tax-rates?active=false').expect(200)).body);
    expect(active.data.map((s) => s.name)).toEqual(['GST 12%', 'GST 28%']);
    const search = slabPage.parse((await a.client.get('/tax-rates?q=exempt').expect(200)).body);
    expect(search.data.map((s) => s.name)).toEqual(['Exempt']);
  });

  it('creates a cess slab (201), renames and deactivates it, then deletes it', async () => {
    const created = taxRateResponseSchema.parse(
      (
        await a.client
          .post('/tax-rates', { name: 'GST 40% + cess 12.5%', gstRate: '40', cessRate: '12.5' })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({
      gstRate: '40.0000',
      cessRate: '12.5000',
      isExempt: false,
      isNilRated: false,
      isNonGst: false,
      isActive: true,
      version: 1,
    });
    const updated = await a.client
      .patch(`/tax-rates/${created.id}`, { name: 'Tobacco', isActive: false, version: 1 })
      .expect(200);
    expect(taxRateResponseSchema.parse(updated.body)).toMatchObject({
      name: 'Tobacco',
      gstRate: '40.0000',
      cessRate: '12.5000',
      isActive: false,
      version: 2,
    });
    expectProblem(
      await a.client.patch(`/tax-rates/${created.id}`, { name: 'Stale', version: 1 }),
      409,
      'VERSION_CONFLICT',
    );
    await a.client.delete(`/tax-rates/${created.id}`).expect(204);
    expect(await auditTrail(a.tenantId, 'tax_rates', created.id)).toEqual([
      { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
      { action: 'UPDATE', changedBy: a.ownerUserId, oldVersion: 1, newVersion: 2 },
      { action: 'DELETE', changedBy: a.ownerUserId, oldVersion: 2, newVersion: null },
    ]);
  });

  it('refuses to change a rate or flag through PATCH (422 unknown key)', async () => {
    const [gst18] = slabPage.parse((await a.client.get('/tax-rates?q=18').expect(200)).body).data;
    const res = await a.client.patch(`/tax-rates/${gst18?.id ?? ''}`, {
      gstRate: '5',
      isExempt: true,
      version: 1,
    });
    expect(expectProblem(res, 422, 'VALIDATION_FAILED').errors).toContainEqual(
      expect.objectContaining({ path: '', code: 'unrecognized_keys' }),
    );
  });

  it('refuses to change a rate even on a raw ekaro_app connection (trigger)', async () => {
    await expect(
      withTenantConnection(a.tenantId, (c) =>
        c.query(`update tax_rates set gst_rate = 5 where name = 'GST 18%'`),
      ),
    ).rejects.toThrow(/rates of tax slab .* are immutable/);
    await withTenantConnection(a.tenantId, (c) =>
      c.query(`update tax_rates set name = 'GST 18 percent' where name = 'GST 18%'`),
    );
    await withTenantConnection(a.tenantId, (c) =>
      c.query(`update tax_rates set name = 'GST 18%' where name = 'GST 18 percent'`),
    );
  });

  it('validates the slab rules (422) and refuses a duplicate slab (409)', async () => {
    expect(
      errorPaths(await a.client.post('/tax-rates', { name: 'Bad', gstRate: '5', isExempt: true })),
    ).toEqual(['gstRate']);
    expect(errorPaths(await a.client.post('/tax-rates', { name: 'Bad', gstRate: '101' }))).toEqual([
      'gstRate',
    ]);
    const dup = await a.client.post('/tax-rates', { name: 'Eighteen', gstRate: '18.00' });
    expectProblem(dup, 409, 'ALREADY_EXISTS');
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.tax_rate:view');
    await (await a.as(view.allowed)).get('/tax-rates').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/tax-rates'), 403, 'FORBIDDEN');
    const create = rolesFor('masters.tax_rate:create');
    const slab = { name: 'GST 7%', gstRate: '7' };
    expectProblem(await (await a.as(create.denied)).post('/tax-rates', slab), 403, 'FORBIDDEN');
    const created = taxRateResponseSchema.parse(
      (await (await a.as(create.allowed)).post('/tax-rates', slab).expect(201)).body,
    );
    const edit = rolesFor('masters.tax_rate:edit');
    const rename = { name: 'GST 7 percent', version: 1 };
    expectProblem(
      await (await a.as(edit.denied)).patch(`/tax-rates/${created.id}`, rename),
      403,
      'FORBIDDEN',
    );
    await (await a.as(edit.allowed)).patch(`/tax-rates/${created.id}`, rename).expect(200);
    const del = rolesFor('masters.tax_rate:delete');
    expectProblem(
      await (await a.as(del.denied)).delete(`/tax-rates/${created.id}`),
      403,
      'FORBIDDEN',
    );
    await (await a.as(del.allowed)).delete(`/tax-rates/${created.id}`).expect(204);
  });

  it("keeps each tenant's slabs to itself", async () => {
    const [aSlab] = slabPage.parse((await a.client.get('/tax-rates?q=40').expect(200)).body).data;
    const id = aSlab?.id ?? '';
    expectProblem(await b.client.get(`/tax-rates/${id}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/tax-rates/${id}`, { name: 'x', version: 1 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await b.client.delete(`/tax-rates/${id}`), 404, 'NOT_FOUND');
    const bPage = slabPage.parse((await b.client.get('/tax-rates').expect(200)).body);
    expect(bPage.data.map((s) => s.id)).not.toContain(id);
  });
});
