import { branchResponseSchema, godownResponseSchema, paginated } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';
import {
  auditTrail,
  createTenant,
  errorPaths,
  expectProblem,
  rolesFor,
  type TestTenant,
} from '../support/masters.js';

const godownPage = paginated(godownResponseSchema);
const branchPage = paginated(branchResponseSchema);

describe('godowns API (spec 02)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;
  let ho = '';
  let other = '';

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
    ho = branchPage.parse((await a.client.get('/branches').expect(200)).body).data[0]?.id ?? '';
    const state = a.owner.gstin.slice(0, 2);
    other = branchResponseSchema.parse(
      (
        await a.client
          .post('/branches', {
            code: 'WH2',
            name: 'Warehouse 2',
            line1: 'Plot 7',
            city: 'Nashik',
            pincode: '422010',
            stateCode: state,
          })
          .expect(201)
      ).body,
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the seeded Main godown and filters by branch', async () => {
    const all = godownPage.parse((await a.client.get('/godowns').expect(200)).body);
    expect(all.data.map((g) => [g.code, g.branchId])).toEqual([['MAIN', ho]]);
    const none = godownPage.parse(
      (await a.client.get(`/godowns?branchId=${other}`).expect(200)).body,
    );
    expect(none.meta.total).toBe(0);
  });

  it('creates, moves, deactivates and audits a godown', async () => {
    const created = godownResponseSchema.parse(
      (
        await a.client
          .post('/godowns', {
            branchId: ho,
            code: 'RM',
            name: 'Raw material store',
            allowNegativeStock: true,
          })
          .expect(201)
      ).body,
    );
    expect(created).toMatchObject({
      branchId: ho,
      allowNegativeStock: true,
      address: null,
      isActive: true,
      version: 1,
    });
    const moved = await a.client
      .patch(`/godowns/${created.id}`, { branchId: other, version: 1 })
      .expect(200);
    expect(godownResponseSchema.parse(moved.body)).toMatchObject({ branchId: other, version: 2 });
    const inOther = godownPage.parse(
      (await a.client.get(`/godowns?branchId=${other}`).expect(200)).body,
    );
    expect(inOther.data.map((g) => g.code)).toEqual(['RM']);
    await a.client.delete(`/godowns/${created.id}`).expect(204);
    const after = godownResponseSchema.parse(
      (await a.client.get(`/godowns/${created.id}`).expect(200)).body,
    );
    expect(after).toMatchObject({ isActive: false, version: 3 });
    expect(await auditTrail(a.tenantId, 'godowns', created.id)).toEqual([
      { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
      { action: 'UPDATE', changedBy: a.ownerUserId, oldVersion: 1, newVersion: 2 },
      { action: 'UPDATE', changedBy: a.ownerUserId, oldVersion: 2, newVersion: 3 },
    ]);
  });

  it('needs an active branch to create, move to or re-activate a godown (422 on branchId)', async () => {
    const parked = godownResponseSchema.parse(
      (
        await a.client
          .post('/godowns', { branchId: other, code: 'PARK', name: 'Parked', isActive: false })
          .expect(201)
      ).body,
    );
    await a.client.delete(`/branches/${other}`).expect(204);
    expect(
      errorPaths(await a.client.post('/godowns', { branchId: other, code: 'NEW', name: 'New' })),
    ).toEqual(['branchId']);
    expect(
      errorPaths(await a.client.patch(`/godowns/${parked.id}`, { isActive: true, version: 1 })),
    ).toEqual(['branchId']);
    // Renaming an inactive godown of an inactive branch is fine.
    await a.client.patch(`/godowns/${parked.id}`, { name: 'Parked stock', version: 1 }).expect(200);
  });

  it('validates fields (422), refuses duplicate codes and stale versions (409)', async () => {
    expect(
      errorPaths(
        await a.client.post('/godowns', { branchId: ho, code: 'X'.repeat(11), name: 'X' }),
      ),
    ).toEqual(['code']);
    expect(
      errorPaths(await a.client.post('/godowns', { branchId: 'nope', code: 'X', name: 'X' })),
    ).toEqual(['branchId']);
    expectProblem(
      await a.client.post('/godowns', { branchId: ho, code: 'MAIN', name: 'Again' }),
      409,
      'ALREADY_EXISTS',
    );
    const [main] = godownPage.parse((await a.client.get('/godowns?q=main').expect(200)).body).data;
    expectProblem(
      await a.client.patch(`/godowns/${main?.id ?? ''}`, { name: 'Stale', version: 9 }),
      409,
      'VERSION_CONFLICT',
    );
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.godown:view');
    await (await a.as(view.allowed)).get('/godowns').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/godowns'), 403, 'FORBIDDEN');
    const create = rolesFor('masters.godown:create');
    const body = { branchId: ho, code: 'PERM', name: 'Permission' };
    expectProblem(await (await a.as(create.denied)).post('/godowns', body), 403, 'FORBIDDEN');
    const created = godownResponseSchema.parse(
      (await (await a.as(create.allowed)).post('/godowns', body).expect(201)).body,
    );
    const edit = rolesFor('masters.godown:edit');
    const patch = { name: 'Renamed', version: 1 };
    expectProblem(
      await (await a.as(edit.denied)).patch(`/godowns/${created.id}`, patch),
      403,
      'FORBIDDEN',
    );
    await (await a.as(edit.allowed)).patch(`/godowns/${created.id}`, patch).expect(200);
    const del = rolesFor('masters.godown:delete');
    expectProblem(
      await (await a.as(del.denied)).delete(`/godowns/${created.id}`),
      403,
      'FORBIDDEN',
    );
    await (await a.as(del.allowed)).delete(`/godowns/${created.id}`).expect(204);
  });

  it("keeps each tenant's godowns and branches to itself", async () => {
    const [main] = godownPage.parse((await a.client.get('/godowns?q=main').expect(200)).body).data;
    const id = main?.id ?? '';
    expectProblem(await b.client.get(`/godowns/${id}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/godowns/${id}`, { name: 'x', version: 1 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await b.client.delete(`/godowns/${id}`), 404, 'NOT_FOUND');
    expect(
      errorPaths(await b.client.post('/godowns', { branchId: ho, code: 'LEAK', name: 'Leak' })),
    ).toEqual(['branchId']);
  });
});
