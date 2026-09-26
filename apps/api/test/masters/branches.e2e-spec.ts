import { branchResponseSchema, godownResponseSchema, paginated } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinOf } from '../factories/gstin.js';
import { createTestApp } from '../support/app.js';
import {
  auditTrail,
  createTenant,
  errorPaths,
  expectProblem,
  rolesFor,
  type TestTenant,
} from '../support/masters.js';

const branchPage = paginated(branchResponseSchema);

const karnataka = (pan: string) => ({
  code: 'BLR',
  name: 'Bengaluru',
  gstin: gstinOf('29', pan),
  line1: '1 Residency Road',
  city: 'Bengaluru',
  pincode: '560025',
  stateCode: '29',
});

describe('branches API (spec 02: one head office, GSTIN per state)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;
  let pan = '';
  let ho = '';

  const branch = async (id: string) =>
    branchResponseSchema.parse((await a.client.get(`/branches/${id}`).expect(200)).body);

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
    pan = a.owner.gstin.slice(2, 12);
    const page = branchPage.parse((await a.client.get('/branches').expect(200)).body);
    ho = page.data[0]?.id ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded head office', async () => {
    const page = branchPage.parse((await a.client.get('/branches').expect(200)).body);
    expect(page.meta.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      code: 'HO',
      gstin: a.owner.gstin,
      isHeadOffice: true,
      isActive: true,
    });
  });

  describe('create and GSTIN rules', () => {
    let blr = '';

    it('adds a branch in another state with its own GSTIN of the company PAN (201)', async () => {
      const res = await a.client.post('/branches', karnataka(pan)).expect(201);
      const created = branchResponseSchema.parse(res.body);
      blr = created.id;
      expect(created).toMatchObject({
        code: 'BLR',
        stateCode: '29',
        gstin: gstinOf('29', pan),
        isHeadOffice: false,
        isActive: true,
        version: 1,
      });
    });

    it('refuses a GSTIN of another state or another PAN (422 on gstin)', async () => {
      const wrongState = { ...karnataka(pan), code: 'BLR2', gstin: gstinOf('27', pan) };
      expect(errorPaths(await a.client.post('/branches', wrongState))).toEqual(['gstin']);
      const otherPan = { ...karnataka(pan), code: 'BLR3', gstin: gstinOf('29', 'AAGCB7383J') };
      expect(errorPaths(await a.client.post('/branches', otherPan))).toEqual(['gstin']);
    });

    it('refuses a duplicate code (409) and a merged record breaking GSTIN vs state (422)', async () => {
      expectProblem(await a.client.post('/branches', karnataka(pan)), 409, 'ALREADY_EXISTS');
      expect(
        errorPaths(await a.client.patch(`/branches/${blr}`, { stateCode: '33', version: 1 })),
      ).toEqual(['gstin']);
    });

    it('moves the head office: the flag leaves the old one (both audited)', async () => {
      const res = await a.client
        .patch(`/branches/${blr}`, { isHeadOffice: true, version: 1 })
        .expect(200);
      expect(branchResponseSchema.parse(res.body)).toMatchObject({
        isHeadOffice: true,
        version: 2,
      });
      expect(await branch(ho)).toMatchObject({ isHeadOffice: false, version: 2 });
      const heads = branchPage
        .parse((await a.client.get('/branches').expect(200)).body)
        .data.filter((x) => x.isHeadOffice);
      expect(heads.map((x) => x.id)).toEqual([blr]);
      expect((await auditTrail(a.tenantId, 'branches', ho)).map((r) => r.action)).toEqual([
        'INSERT',
        'UPDATE',
      ]);
      // And back again.
      await a.client.patch(`/branches/${ho}`, { isHeadOffice: true, version: 2 }).expect(200);
      expect(await branch(blr)).toMatchObject({ isHeadOffice: false, version: 3 });
    });

    it('never leaves the tenant without an active head office (422 HEAD_OFFICE_REQUIRED)', async () => {
      const { version } = await branch(ho);
      expectProblem(
        await a.client.patch(`/branches/${ho}`, { isHeadOffice: false, version }),
        422,
        'HEAD_OFFICE_REQUIRED',
      );
      expectProblem(
        await a.client.patch(`/branches/${ho}`, { isActive: false, version }),
        422,
        'HEAD_OFFICE_REQUIRED',
      );
      expectProblem(await a.client.delete(`/branches/${ho}`), 422, 'HEAD_OFFICE_REQUIRED');
    });

    it('refuses to deactivate a branch with active godowns (409), then allows it', async () => {
      const godown = godownResponseSchema.parse(
        (
          await a.client
            .post('/godowns', { branchId: blr, code: 'BLR-1', name: 'Bengaluru store' })
            .expect(201)
        ).body,
      );
      expectProblem(await a.client.delete(`/branches/${blr}`), 409, 'BRANCH_HAS_ACTIVE_GODOWNS');
      await a.client.delete(`/godowns/${godown.id}`).expect(204);
      await a.client.delete(`/branches/${blr}`).expect(204);
      expect(await branch(blr)).toMatchObject({ isActive: false, version: 4 });
      const inactive = branchPage.parse(
        (await a.client.get('/branches?active=false').expect(200)).body,
      );
      expect(inactive.data.map((x) => x.code)).toEqual(['BLR']);
      // An inactive branch cannot become the head office.
      expect(
        errorPaths(await a.client.patch(`/branches/${blr}`, { isHeadOffice: true, version: 4 })),
      ).toEqual(['isHeadOffice']);
    });

    it('refuses a stale version (409)', async () => {
      expectProblem(
        await a.client.patch(`/branches/${blr}`, { name: 'Stale', version: 1 }),
        409,
        'VERSION_CONFLICT',
      );
    });
  });

  it('searches and sorts', async () => {
    await a.client
      .post('/branches', {
        code: 'PUN2',
        name: 'Pune Hadapsar',
        line1: 'x',
        city: 'Pune',
        pincode: '411028',
        stateCode: a.owner.gstin.slice(0, 2),
      })
      .expect(201);
    const found = branchPage.parse((await a.client.get('/branches?q=hadapsar').expect(200)).body);
    expect(found.data.map((x) => x.code)).toEqual(['PUN2']);
    const sorted = branchPage.parse(
      (await a.client.get('/branches?sort=code:desc').expect(200)).body,
    );
    expect(sorted.data.map((x) => x.code)).toEqual(['PUN2', 'HO', 'BLR']);
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.branch:view');
    await (await a.as(view.allowed)).get('/branches').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/branches'), 403, 'FORBIDDEN');
    const create = rolesFor('masters.branch:create');
    const body = { ...karnataka(pan), code: 'PERM' };
    expectProblem(await (await a.as(create.denied)).post('/branches', body), 403, 'FORBIDDEN');
    const created = branchResponseSchema.parse(
      (await (await a.as(create.allowed)).post('/branches', body).expect(201)).body,
    );
    const edit = rolesFor('masters.branch:edit');
    const patch = { name: 'Renamed', version: 1 };
    expectProblem(
      await (await a.as(edit.denied)).patch(`/branches/${created.id}`, patch),
      403,
      'FORBIDDEN',
    );
    await (await a.as(edit.allowed)).patch(`/branches/${created.id}`, patch).expect(200);
    const del = rolesFor('masters.branch:delete');
    expectProblem(
      await (await a.as(del.denied)).delete(`/branches/${created.id}`),
      403,
      'FORBIDDEN',
    );
    await (await a.as(del.allowed)).delete(`/branches/${created.id}`).expect(204);
  });

  it("keeps each tenant's branches to itself", async () => {
    expectProblem(await b.client.get(`/branches/${ho}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/branches/${ho}`, { name: 'x', version: 3 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await b.client.delete(`/branches/${ho}`), 404, 'NOT_FOUND');
    const bPage = branchPage.parse((await b.client.get('/branches').expect(200)).body);
    expect(bPage.data.map((x) => x.code)).toEqual(['HO']);
    expect(bPage.data[0]?.id).not.toBe(ho);
  });
});
