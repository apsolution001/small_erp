import { paginated, unitResponseSchema } from '@ekaro/contracts';
import { uuidv7 } from '@ekaro/core';
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

const unitPage = paginated(unitResponseSchema);

describe('units API (spec 02, the reference master)', () => {
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

  describe('list', () => {
    it('pages the 18 seeded units by code, with the total', async () => {
      const res = await a.client.get('/units?pageSize=5&page=2').expect(200);
      const page = unitPage.parse(res.body);
      expect(page.meta).toEqual({ page: 2, pageSize: 5, total: 18 });
      // BAG BOX CMS DOZ GMS | KGS LTR MLT MTR NOS | OTH PAC PCS ROL SET | SQF SQM TON
      expect(page.data.map((u) => u.code)).toEqual(['KGS', 'LTR', 'MLT', 'MTR', 'NOS']);
    });

    it('searches code and name case-insensitively, and sorts on allowed columns', async () => {
      const byName = unitPage.parse((await a.client.get('/units?q=kilo').expect(200)).body);
      expect(byName.data.map((u) => u.code)).toEqual(['KGS']);
      expect(byName.meta.total).toBe(1);
      const byCode = unitPage.parse((await a.client.get('/units?q=sq').expect(200)).body);
      expect(byCode.data.map((u) => u.code)).toEqual(['SQF', 'SQM']);
      const desc = unitPage.parse((await a.client.get('/units?sort=code:desc').expect(200)).body);
      expect(desc.data[0]?.code).toBe('TON');
    });

    it('treats LIKE wildcards in the search as literal characters', async () => {
      const res = await a.client.get('/units?q=%25').expect(200);
      expect(unitPage.parse(res.body).meta.total).toBe(0);
    });

    it('rejects an undeclared sort column and unknown parameters with 422', async () => {
      expect(errorPaths(await a.client.get('/units?sort=uqc:asc'))).toEqual(['sort']);
      expect(errorPaths(await a.client.get('/units?tenantId=x'))).toEqual(['']);
      expect(errorPaths(await a.client.get('/units?pageSize=201'))).toEqual(['pageSize']);
    });
  });

  describe('create, read, update, delete', () => {
    let id = '';

    it('creates a unit (201), normalising the code, and reads it back', async () => {
      const res = await a.client
        .post('/units', { code: ' crt ', name: 'Crate', uqc: 'CTN' })
        .expect(201);
      const unit = unitResponseSchema.parse(res.body);
      id = unit.id;
      expect(unit).toMatchObject({
        code: 'CRT',
        name: 'Crate',
        uqc: 'CTN',
        decimalPlaces: 0,
        isActive: true,
        version: 1,
      });
      expect(res.body).not.toHaveProperty('tenantId');
      expect((await a.client.get(`/units/${id}`).expect(200)).body).toEqual(res.body);
    });

    it('updates with the current version, bumping it, and filters by active', async () => {
      const res = await a.client
        .patch(`/units/${id}`, {
          name: 'Crate of 12',
          decimalPlaces: 2,
          isActive: false,
          version: 1,
        })
        .expect(200);
      expect(unitResponseSchema.parse(res.body)).toMatchObject({
        code: 'CRT',
        name: 'Crate of 12',
        decimalPlaces: 2,
        isActive: false,
        version: 2,
      });
      const inactive = unitPage.parse((await a.client.get('/units?active=false').expect(200)).body);
      expect(inactive.data.map((u) => u.code)).toEqual(['CRT']);
      const active = unitPage.parse((await a.client.get('/units?active=true').expect(200)).body);
      expect(active.meta.total).toBe(18);
    });

    it('refuses a stale version with 409 VERSION_CONFLICT and changes nothing', async () => {
      const res = await a.client.patch(`/units/${id}`, { name: 'Lost update', version: 1 });
      expectProblem(res, 409, 'VERSION_CONFLICT');
      expect((await a.client.get(`/units/${id}`).expect(200)).body.name).toBe('Crate of 12');
    });

    it('deletes an unused unit (204), after which it is gone (404)', async () => {
      await a.client.delete(`/units/${id}`).expect(204);
      expectProblem(await a.client.get(`/units/${id}`), 404, 'NOT_FOUND');
      expectProblem(await a.client.delete(`/units/${id}`), 404, 'NOT_FOUND');
    });

    it('writes an audit row for each change, by the acting user, with the versions', async () => {
      expect(await auditTrail(a.tenantId, 'units', id)).toEqual([
        { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
        { action: 'UPDATE', changedBy: a.ownerUserId, oldVersion: 1, newVersion: 2 },
        { action: 'DELETE', changedBy: a.ownerUserId, oldVersion: 2, newVersion: null },
      ]);
    });
  });

  describe('validation (422)', () => {
    it('rejects bad fields, unknown keys and malformed ids', async () => {
      expect(
        errorPaths(await a.client.post('/units', { code: 'SACK', name: 'Sack', uqc: 'SAK' })),
      ).toEqual(['uqc']);
      expect(
        errorPaths(
          await a.client.post('/units', { code: 'X', name: 'X', uqc: 'OTH', decimalPlaces: 7 }),
        ),
      ).toEqual(['decimalPlaces']);
      expect(
        errorPaths(
          await a.client.post('/units', { code: 'X', name: 'X', uqc: 'OTH', tenantId: b.tenantId }),
        ),
      ).toEqual(['']);
      expect(errorPaths(await a.client.get('/units/not-a-uuid'))).toEqual(['']);
    });

    it('needs a version and at least one change on PATCH', async () => {
      const kgs = unitPage.parse((await a.client.get('/units?q=KGS').expect(200)).body).data[0];
      expect(errorPaths(await a.client.patch(`/units/${kgs?.id ?? ''}`, { name: 'Kilo' }))).toEqual(
        ['version'],
      );
      expect(errorPaths(await a.client.patch(`/units/${kgs?.id ?? ''}`, { version: 1 }))).toEqual([
        '',
      ]);
    });
  });

  it('refuses a duplicate code with 409 ALREADY_EXISTS, on create and on update', async () => {
    const dup = await a.client.post('/units', { code: 'bag', name: 'Another bag', uqc: 'BAG' });
    expect(expectProblem(dup, 409, 'ALREADY_EXISTS').detail).toBe(
      'A unit with code BAG already exists.',
    );
    const own = unitResponseSchema.parse(
      (await a.client.post('/units', { code: 'SACK', name: 'Sack', uqc: 'BAG' }).expect(201)).body,
    );
    expectProblem(
      await a.client.patch(`/units/${own.id}`, { code: 'NOS', version: own.version }),
      409,
      'ALREADY_EXISTS',
    );
  });

  describe('permissions', () => {
    it('lets a role with masters.unit:view list, and refuses one without it (403)', async () => {
      const { allowed, denied } = rolesFor('masters.unit:view');
      await (await a.as(allowed)).get('/units').expect(200);
      expectProblem(await (await a.as(denied)).get('/units'), 403, 'FORBIDDEN');
    });

    it('allows create, edit and delete only with the matching permission', async () => {
      const creator = rolesFor('masters.unit:create');
      expectProblem(
        await (await a.as(creator.denied)).post('/units', { code: 'P1', name: 'P', uqc: 'OTH' }),
        403,
        'FORBIDDEN',
      );
      const unit = unitResponseSchema.parse(
        (
          await (
            await a.as(creator.allowed)
          )
            .post('/units', { code: 'P1', name: 'P', uqc: 'OTH' })
            .expect(201)
        ).body,
      );
      const editor = rolesFor('masters.unit:edit');
      expectProblem(
        await (await a.as(editor.denied)).patch(`/units/${unit.id}`, { name: 'Q', version: 1 }),
        403,
        'FORBIDDEN',
      );
      await (
        await a.as(editor.allowed)
      )
        .patch(`/units/${unit.id}`, { name: 'Q', version: 1 })
        .expect(200);
      const deleter = rolesFor('masters.unit:delete');
      expectProblem(
        await (await a.as(deleter.denied)).delete(`/units/${unit.id}`),
        403,
        'FORBIDDEN',
      );
      await (await a.as(deleter.allowed)).delete(`/units/${unit.id}`).expect(204);
    });
  });

  describe('tenant isolation', () => {
    it("B can neither see nor change A's units through the API (404, never 403)", async () => {
      const aUnit = unitResponseSchema.parse(
        (await a.client.post('/units', { code: 'ISO', name: 'Isolated', uqc: 'OTH' }).expect(201))
          .body,
      );
      expectProblem(await b.client.get(`/units/${aUnit.id}`), 404, 'NOT_FOUND');
      expectProblem(
        await b.client.patch(`/units/${aUnit.id}`, { name: 'Hijack', version: 1 }),
        404,
        'NOT_FOUND',
      );
      expectProblem(await b.client.delete(`/units/${aUnit.id}`), 404, 'NOT_FOUND');
      const bList = unitPage.parse((await b.client.get('/units?q=ISO').expect(200)).body);
      expect(bList.data).toEqual([]);
      expect((await a.client.get(`/units/${aUnit.id}`).expect(200)).body.name).toBe('Isolated');
      // B may use the same code in its own tenant.
      await b.client.post('/units', { code: 'ISO', name: 'Mine', uqc: 'OTH' }).expect(201);
    });

    it('404s an id that exists nowhere', async () => {
      expectProblem(await a.client.get(`/units/${uuidv7()}`), 404, 'NOT_FOUND');
    });
  });
});
