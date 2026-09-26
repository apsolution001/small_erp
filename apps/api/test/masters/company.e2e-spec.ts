import {
  companyResponseSchema,
  itemTaxRateResponseSchema,
  paginated,
  taxRateResponseSchema,
  unitResponseSchema,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { STOCK_POSTINGS } from '../../src/modules/masters/company/stock-postings.port.js';
import { createTestApp } from '../support/app.js';
import { withTenantConnection } from '../support/db.js';
import {
  createTenant,
  errorPaths,
  expectProblem,
  rolesFor,
  type TestTenant,
} from '../support/masters.js';

/** Stands in for the posting engine (Sprint 2): a switch the tests flip. */
const postings = { posted: false, hasStockPostings: () => Promise.resolve(postings.posted) };

describe('company API (spec 02 §2–3)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    app = await createTestApp({ providers: [{ token: STOCK_POSTINGS, useValue: postings }] });
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
  });

  afterAll(async () => {
    await app.close();
  });

  const company = async (tenant: TestTenant) =>
    companyResponseSchema.parse((await tenant.client.get('/company').expect(200)).body);

  it("returns the tenant's own profile, seeded from its GSTIN", async () => {
    const profile = await company(a);
    expect(profile).toMatchObject({
      gstin: a.owner.gstin,
      pan: a.owner.gstin.slice(2, 12),
      stateCode: a.owner.gstin.slice(0, 2),
      valuationMethod: 'weighted_average',
      hsnMinDigits: 4,
      roundOffSales: true,
      allowNegativeStock: false,
      eInvoiceEnabled: false,
      version: 1,
    });
    expect((await company(b)).gstin).toBe(b.owner.gstin);
  });

  it('updates settings with the current version, auditing the change', async () => {
    const res = await a.client
      .patch('/company', {
        tradeName: 'Acme Steel',
        hsnMinDigits: 6,
        eInvoiceEnabled: true,
        phone: '+912024567890',
        version: 1,
      })
      .expect(200);
    expect(companyResponseSchema.parse(res.body)).toMatchObject({
      tradeName: 'Acme Steel',
      hsnMinDigits: 6,
      eInvoiceEnabled: true,
      phone: '+912024567890',
      version: 2,
    });
    const audit = await withTenantConnection(a.tenantId, async (c) => {
      const { rows } = await c.query<{ action: string; changedBy: string; hsn: string }>(
        `select action, changed_by as "changedBy", new_data->>'hsn_min_digits' as hsn
           from audit_log where table_name = 'company_profile' and action = 'UPDATE'`,
      );
      return rows;
    });
    expect(audit).toEqual([{ action: 'UPDATE', changedBy: a.ownerUserId, hsn: '6' }]);
    expectProblem(
      await a.client.patch('/company', { tradeName: 'Stale', version: 1 }),
      409,
      'VERSION_CONFLICT',
    );
  });

  it('validates fields and the merged record (422)', async () => {
    expect(errorPaths(await a.client.patch('/company', { hsnMinDigits: 8, version: 2 }))).toEqual([
      'hsnMinDigits',
    ]);
    // A state that does not match the stored GSTIN.
    const otherState = a.owner.gstin.startsWith('29') ? '27' : '29';
    expect(
      errorPaths(await a.client.patch('/company', { stateCode: otherState, version: 2 })),
    ).toEqual(['gstin']);
    expect(
      errorPaths(await a.client.patch('/company', { logoObjectKey: 'x', gstin: null, version: 2 })),
    ).toEqual(['']);
  });

  describe('locks after the first stock posting', () => {
    it('changes the valuation method while nothing is posted', async () => {
      const res = await a.client
        .patch('/company', { valuationMethod: 'fifo', version: 2 })
        .expect(200);
      expect(companyResponseSchema.parse(res.body)).toMatchObject({
        valuationMethod: 'fifo',
        version: 3,
      });
    });

    it('refuses the valuation method and books date once stock is posted (409)', async () => {
      postings.posted = true;
      try {
        expectProblem(
          await a.client.patch('/company', { valuationMethod: 'weighted_average', version: 3 }),
          409,
          'VALUATION_METHOD_LOCKED',
        );
        expectProblem(
          await a.client.patch('/company', { booksBeginDate: '2025-04-01', version: 3 }),
          409,
          'BOOKS_BEGIN_DATE_LOCKED',
        );
        // Other settings stay editable.
        await a.client.patch('/company', { roundOffSales: false, version: 3 }).expect(200);
      } finally {
        postings.posted = false;
      }
    });

    it('moving the books earlier gives every item a rate from the new date', async () => {
      const units = paginated(unitResponseSchema).parse(
        (await b.client.get('/units?q=NOS').expect(200)).body,
      );
      const slabs = paginated(taxRateResponseSchema).parse(
        (await b.client.get('/tax-rates?q=18').expect(200)).body,
      );
      const item = await b.client
        .post('/items', {
          code: 'BOLT',
          name: 'Bolt',
          itemType: 'goods',
          itemKind: 'trading',
          hsnSac: '7318',
          baseUnitId: units.data[0]?.id,
          taxRateId: slabs.data[0]?.id,
        })
        .expect(201);
      const itemId = (item.body as { id: string }).id;
      const before = await company(b);
      const earlier = `${String(Number(before.booksBeginDate.slice(0, 4)) - 1)}-04-01`;
      await b.client
        .patch('/company', { booksBeginDate: earlier, version: before.version })
        .expect(200);
      const rows = z
        .array(itemTaxRateResponseSchema)
        .parse((await b.client.get(`/items/${itemId}/tax-rates`).expect(200)).body);
      expect(rows.map((r) => [r.taxRateId, r.effectiveFrom])).toEqual([
        [slabs.data[0]?.id, earlier],
        [slabs.data[0]?.id, before.booksBeginDate],
      ]);
    });
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.company:view');
    await (await a.as(view.allowed)).get('/company').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/company'), 403, 'FORBIDDEN');
    const edit = rolesFor('masters.company:edit');
    const { version } = await company(a);
    expectProblem(
      await (await a.as(edit.denied)).patch('/company', { roundOffSales: true, version }),
      403,
      'FORBIDDEN',
    );
    await (
      await a.as(edit.allowed)
    )
      .patch('/company', { roundOffSales: true, version })
      .expect(200);
  });

  it("never touches another tenant's profile", async () => {
    const bBefore = await company(b);
    const aNow = await company(a);
    await a.client.patch('/company', { tradeName: 'Only A', version: aNow.version }).expect(200);
    expect(await company(b)).toEqual(bBefore);
  });
});
