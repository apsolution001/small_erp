import { branchResponseSchema, documentSeriesResponseSchema, paginated } from '@ekaro/contracts';
import { formatDocNumber, fyShort } from '@ekaro/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinOf } from '../factories/gstin.js';
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

const seriesPage = paginated(documentSeriesResponseSchema);

describe('document series API (MS-05, GST rule 46, ADR 0010)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;
  let ho = '';
  let fy = '';
  let yy = '';

  const series = async (id: string) =>
    documentSeriesResponseSchema.parse(
      (await a.client.get(`/document-series/${id}`).expect(200)).body,
    );
  const defaultOf = async (docType: string) => {
    const page = seriesPage.parse(
      (await a.client.get(`/document-series?docType=${docType}&branchId=${ho}`).expect(200)).body,
    );
    return page.data.find((s) => s.isDefault);
  };
  const addBranch = async (code: string, gstin: string | null, stateCode: string) =>
    branchResponseSchema.parse(
      (
        await a.client
          .post('/branches', {
            code,
            name: code,
            gstin,
            line1: 'x',
            city: 'x',
            pincode: '560025',
            stateCode,
          })
          .expect(201)
      ).body,
    ).id;

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
    const seeded = seriesPage.parse(
      (await a.client.get('/document-series?pageSize=50').expect(200)).body,
    );
    ho = seeded.data[0]?.branchId ?? '';
    fy = seeded.data[0]?.fy ?? '';
    yy = fyShort(fy);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the 21 seeded defaults, filterable by type and FY, with nothing issued', async () => {
    const page = seriesPage.parse(
      (await a.client.get('/document-series?pageSize=50').expect(200)).body,
    );
    expect(page.meta.total).toBe(21);
    expect(
      page.data.every((s) => s.isDefault && s.lastIssuedNumber === null && s.nextNumber === '1'),
    ).toBe(true);
    const si = await defaultOf('sales_invoice');
    expect(si).toMatchObject({ prefix: `SI/${yy}/`, suffix: '', padding: 4, fy });
    expect(formatDocNumber({ prefix: si?.prefix ?? '', suffix: '', padding: 4 }, 1)).toBe(
      `SI/${yy}/0001`,
    );
    const byFy = seriesPage.parse(
      (await a.client.get(`/document-series?fy=${fy}&q=PO/`).expect(200)).body,
    );
    expect(byFy.data.map((s) => s.docType)).toEqual(['purchase_order']);
  });

  describe('create', () => {
    it('adds an export invoice series and can make it the default (the flag moves)', async () => {
      const res = await a.client
        .post('/document-series', {
          branchId: ho,
          docType: 'sales_invoice',
          fy,
          prefix: `exp/${yy}/`,
          nextNumber: '101',
          isDefault: true,
        })
        .expect(201);
      expect(documentSeriesResponseSchema.parse(res.body)).toMatchObject({
        prefix: `EXP/${yy}/`,
        padding: 4,
        nextNumber: '101',
        lastIssuedNumber: null,
        isDefault: true,
        version: 1,
      });
      expect((await defaultOf('sales_invoice'))?.prefix).toBe(`EXP/${yy}/`);
      const old = seriesPage
        .parse(
          (await a.client.get(`/document-series?docType=sales_invoice&q=SI/`).expect(200)).body,
        )
        .data.find((s) => s.prefix === `SI/${yy}/`);
      expect(old).toMatchObject({ isDefault: false, version: 2 });
    });

    it('rejects numbers wider than 16 characters (422)', async () => {
      const wide = { branchId: ho, docType: 'grn', fy, prefix: 'ABCDEFGHIJ', padding: 8 };
      expect(errorPaths(await a.client.post('/document-series', wide))).toEqual(['padding']);
      const next = {
        branchId: ho,
        docType: 'grn',
        fy,
        prefix: 'GRN/X/',
        padding: 4,
        nextNumber: '12345678901',
      };
      expect(errorPaths(await a.client.post('/document-series', next))).toEqual(['nextNumber']);
    });

    it('refuses a series that could repeat numbers under the same GSTIN (409 SERIES_NUMBERS_OVERLAP)', async () => {
      // SI/yy-yy/0 + 3 digits renders SI/yy-yy/0001, which the default already issues.
      const shadow = {
        branchId: ho,
        docType: 'sales_invoice',
        fy,
        prefix: `SI/${yy}/0`,
        padding: 3,
      };
      expectProblem(await a.client.post('/document-series', shadow), 409, 'SERIES_NUMBERS_OVERLAP');
      // Credit and debit notes share one number space: CN may not reuse DN's pattern.
      const note = { branchId: ho, docType: 'credit_note', fy, prefix: `DN/${yy}/` };
      expectProblem(await a.client.post('/document-series', note), 409, 'SERIES_NUMBERS_OVERLAP');
      // A same-state branch without its own GSTIN issues under the company's: still a clash.
      const sameState = await addBranch('PUN2', null, a.owner.gstin.slice(0, 2));
      expectProblem(
        await a.client.post('/document-series', {
          branchId: sameState,
          docType: 'sales_invoice',
          fy,
          prefix: `SI/${yy}/`,
        }),
        409,
        'SERIES_NUMBERS_OVERLAP',
      );
    });

    it('allows the same pattern under another GSTIN, or in another FY', async () => {
      const pan = a.owner.gstin.slice(2, 12);
      const blr = await addBranch('BLR', gstinOf('29', pan), '29');
      await a.client
        .post('/document-series', {
          branchId: blr,
          docType: 'sales_invoice',
          fy,
          prefix: `SI/${yy}/`,
          isDefault: true,
        })
        .expect(201);
      await a.client
        .post('/document-series', {
          branchId: ho,
          docType: 'sales_invoice',
          fy: '2099-00',
          prefix: 'SI/99-00/',
        })
        .expect(201);
    });

    it('refuses a duplicate key and an unknown or inactive branch', async () => {
      const dup = { branchId: ho, docType: 'grn', fy, prefix: `GRN/${yy}/` };
      expectProblem(await a.client.post('/document-series', dup), 409, 'SERIES_NUMBERS_OVERLAP');
      expect(
        errorPaths(
          await a.client.post('/document-series', { ...dup, branchId: b.tenantId, prefix: 'Z/' }),
        ),
      ).toEqual(['branchId']);
    });
  });

  describe('update', () => {
    let id = '';

    beforeAll(async () => {
      id = documentSeriesResponseSchema.parse(
        (
          await a.client
            .post('/document-series', { branchId: ho, docType: 'quotation', fy, prefix: 'QX/' })
            .expect(201)
        ).body,
      ).id;
    });

    it('changes the numbering while nothing is issued; the next number only increases', async () => {
      const res = await a.client
        .patch(`/document-series/${id}`, {
          prefix: 'qz/',
          padding: 5,
          nextNumber: '500',
          version: 1,
        })
        .expect(200);
      expect(documentSeriesResponseSchema.parse(res.body)).toMatchObject({
        prefix: 'QZ/',
        padding: 5,
        nextNumber: '500',
        version: 2,
      });
      expectProblem(
        await a.client.patch(`/document-series/${id}`, { nextNumber: '499', version: 2 }),
        422,
        'SERIES_NUMBER_DECREASE',
      );
      expect(
        errorPaths(
          await a.client.patch(`/document-series/${id}`, {
            padding: 8,
            prefix: 'ABCDEFGHI/',
            version: 2,
          }),
        ),
      ).toEqual(['padding']);
      expectProblem(
        await a.client.patch(`/document-series/${id}`, { padding: 6, version: 1 }),
        409,
        'VERSION_CONFLICT',
      );
    });

    it('fixes the numbering once a number is issued (409), keeping the default flag editable', async () => {
      // What number allocation will do in Sprint 2: issue 500.
      await withTenantConnection(a.tenantId, (c) =>
        c.query(
          'update document_series set last_issued_number = next_number, next_number = next_number + 1 where id = $1',
          [id],
        ),
      );
      const issued = await series(id);
      expect(issued).toMatchObject({ nextNumber: '501', lastIssuedNumber: '500', version: 2 });
      for (const patch of [
        { prefix: 'QQ/' },
        { suffix: '/A' },
        { padding: 6 },
        { nextNumber: '900' },
      ]) {
        expectProblem(
          await a.client.patch(`/document-series/${id}`, { ...patch, version: 2 }),
          409,
          'SERIES_NUMBERING_LOCKED',
        );
      }
      await a.client.patch(`/document-series/${id}`, { isDefault: true, version: 2 }).expect(200);
      expect((await defaultOf('quotation'))?.id).toBe(id);
    });

    it('holds the same rules on a raw ekaro_app connection (trigger)', async () => {
      const raw = (statement: string) =>
        withTenantConnection(a.tenantId, (c) => c.query(statement, [id]));
      await expect(raw(`update document_series set prefix = 'QQ/' where id = $1`)).rejects.toThrow(
        /numbering is fixed/,
      );
      await expect(
        raw('update document_series set next_number = 2, last_issued_number = 1 where id = $1'),
      ).rejects.toThrow(/cannot go back/);
      await expect(raw(`update document_series set fy = '2030-31' where id = $1`)).rejects.toThrow(
        /cannot change/,
      );
      await expect(
        raw('update document_series set next_number = 900 where id = $1'),
      ).rejects.toThrow(/document_series_next_follows_last_issued/);
    });

    it('audits every change with the versions', async () => {
      expect(
        (await auditTrail(a.tenantId, 'document_series', id)).map((r) => [r.action, r.newVersion]),
      ).toEqual([
        ['INSERT', 1],
        ['UPDATE', 2],
        ['UPDATE', 2],
        ['UPDATE', 3],
      ]);
    });
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.series:view');
    await (await a.as(view.allowed)).get('/document-series').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/document-series'), 403, 'FORBIDDEN');
    const create = rolesFor('masters.series:create');
    const body = { branchId: ho, docType: 'journal', fy, prefix: 'JX/' };
    expectProblem(
      await (await a.as(create.denied)).post('/document-series', body),
      403,
      'FORBIDDEN',
    );
    const created = documentSeriesResponseSchema.parse(
      (await (await a.as(create.allowed)).post('/document-series', body).expect(201)).body,
    );
    const edit = rolesFor('masters.series:edit');
    const patch = { nextNumber: '10', version: 1 };
    expectProblem(
      await (await a.as(edit.denied)).patch(`/document-series/${created.id}`, patch),
      403,
      'FORBIDDEN',
    );
    await (await a.as(edit.allowed)).patch(`/document-series/${created.id}`, patch).expect(200);
  });

  it("keeps each tenant's series to itself", async () => {
    const si = await defaultOf('sales_invoice');
    const id = si?.id ?? '';
    expectProblem(await b.client.get(`/document-series/${id}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/document-series/${id}`, { nextNumber: '5', version: 2 }),
      404,
      'NOT_FOUND',
    );
    expect(
      errorPaths(
        await b.client.post('/document-series', {
          branchId: ho,
          docType: 'grn',
          fy,
          prefix: 'LEAK/',
        }),
      ),
    ).toEqual(['branchId']);
    const bPage = seriesPage.parse(
      (await b.client.get('/document-series?pageSize=50').expect(200)).body,
    );
    expect(bPage.meta.total).toBe(21);
  });
});
