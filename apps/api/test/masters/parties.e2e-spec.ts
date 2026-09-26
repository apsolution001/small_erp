import { paginated, partyResponseSchema } from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeGstin, gstinOf } from '../factories/gstin.js';
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

const partyPage = paginated(partyResponseSchema);

const puneBilling = {
  kind: 'billing',
  line1: '12 MG Road',
  city: 'Pune',
  stateCode: '27',
  pincode: '411001',
  isDefault: true,
};
const nashikShipping = {
  kind: 'shipping',
  label: 'Warehouse',
  line1: 'Plot 7, MIDC',
  city: 'Nashik',
  stateCode: '27',
  pincode: '422010',
  isDefault: true,
};

describe('parties API (MS-03: GSTIN rules, addresses, credit limit in paise)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;
  let gstin = '';

  const regular = (overrides: object = {}) => ({
    code: 'C-001',
    name: 'Acme Steel Traders',
    partyType: 'customer',
    gstRegistrationType: 'regular',
    gstin,
    creditLimit: '5000000000',
    creditDays: 30,
    addresses: [puneBilling, nashikShipping],
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
    gstin = activeGstin('27');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create and read', () => {
    let id = '';

    it('creates a registered customer with addresses; the credit limit comes back in exact paise', async () => {
      const res = await a.client.post('/parties', regular()).expect(201);
      const party = partyResponseSchema.parse(res.body);
      id = party.id;
      expect(party).toMatchObject({
        code: 'C-001',
        gstin,
        pan: null,
        creditLimit: '5000000000',
        creditDays: 30,
        isActive: true,
        version: 1,
      });
      expect(
        party.addresses.map((x) => [x.kind, x.city, x.stateCode, x.country, x.isDefault]),
      ).toEqual([
        ['billing', 'Pune', '27', 'IN', true],
        ['shipping', 'Nashik', '27', 'IN', true],
      ]);
      expect((await a.client.get(`/parties/${id}`).expect(200)).body).toEqual(res.body);
    });

    it('keeps credit limits beyond 2^53 paise exact, and "0" as cash only, null as no limit', async () => {
      const big = await a.client
        .post('/parties', regular({ code: 'C-BIG', creditLimit: '9007199254740993' }))
        .expect(201);
      expect(partyResponseSchema.parse(big.body).creditLimit).toBe('9007199254740993');
      const stored = await withTenantConnection(a.tenantId, async (c) => {
        const { rows } = await c.query<{ v: string }>(
          `select credit_limit::text as v from parties where code = 'C-BIG'`,
        );
        return rows[0]?.v;
      });
      expect(stored).toBe('9007199254740993');
      const cash = await a.client
        .post('/parties', regular({ code: 'C-CASH', creditLimit: '0' }))
        .expect(201);
      expect(partyResponseSchema.parse(cash.body).creditLimit).toBe('0');
      const open = await a.client
        .post('/parties', regular({ code: 'C-OPEN', creditLimit: null }))
        .expect(201);
      expect(partyResponseSchema.parse(open.body).creditLimit).toBeNull();
    });

    it('creates an unregistered consumer and an overseas vendor without GSTIN', async () => {
      await a.client
        .post('/parties', {
          code: 'WALKIN',
          name: 'Walk-in customer',
          partyType: 'customer',
          gstRegistrationType: 'consumer',
          addresses: [puneBilling],
        })
        .expect(201);
      const overseas = await a.client
        .post('/parties', {
          code: 'V-US',
          name: 'Steel Corp USA',
          partyType: 'vendor',
          gstRegistrationType: 'overseas',
          addresses: [
            {
              kind: 'billing',
              line1: '1 Main St',
              city: 'New York',
              country: 'US',
              pincode: '10001',
              isDefault: true,
            },
          ],
        })
        .expect(201);
      expect(partyResponseSchema.parse(overseas.body).addresses[0]).toMatchObject({
        country: 'US',
        stateCode: null,
        pincode: '10001',
      });
    });

    it('searches name, code and GSTIN, and filters by type (both counts as either)', async () => {
      await a.client
        .post(
          '/parties',
          regular({
            code: 'B-001',
            name: 'Both Ways Pvt Ltd',
            partyType: 'both',
            gstin: activeGstin('27'),
          }),
        )
        .expect(201);
      const byName = partyPage.parse((await a.client.get('/parties?q=acme').expect(200)).body);
      expect(byName.data.map((p) => p.code)).toEqual(['C-001', 'C-BIG', 'C-CASH', 'C-OPEN']);
      const byGstin = partyPage.parse(
        (await a.client.get(`/parties?q=${gstin.slice(0, 8).toLowerCase()}`).expect(200)).body,
      );
      expect(byGstin.data.map((p) => p.code)).toContain('C-001');
      const byCode = partyPage.parse((await a.client.get('/parties?q=V-US').expect(200)).body);
      expect(byCode.data.map((p) => p.code)).toEqual(['V-US']);
      const vendors = partyPage.parse(
        (await a.client.get('/parties?type=vendor').expect(200)).body,
      );
      expect(vendors.data.map((p) => p.code)).toEqual(['B-001', 'V-US']);
      const sorted = partyPage.parse(
        (await a.client.get('/parties?sort=code:asc&pageSize=2').expect(200)).body,
      );
      expect(sorted.data.map((p) => p.code)).toEqual(['B-001', 'C-001']);
      expect(sorted.meta.total).toBe(7);
    });

    it('updates the party and replaces its addresses, keeping ids and moving the default', async () => {
      const current = partyResponseSchema.parse(
        (await a.client.get(`/parties/${id}`).expect(200)).body,
      );
      const [billing, shipping] = current.addresses;
      const res = await a.client
        .patch(`/parties/${id}`, {
          creditLimit: '7500000000',
          addresses: [
            { ...puneBilling, id: billing?.id, isDefault: false },
            { ...puneBilling, line1: '44 FC Road', pincode: '411004', isDefault: true },
            { ...nashikShipping, id: shipping?.id, label: 'Main warehouse' },
          ],
          version: 1,
        })
        .expect(200);
      const updated = partyResponseSchema.parse(res.body);
      expect(updated).toMatchObject({ creditLimit: '7500000000', version: 2 });
      // Oldest first: the two kept addresses, then the new default billing address.
      expect(
        updated.addresses.map((x) => [
          x.id === billing?.id || x.id === shipping?.id,
          x.kind,
          x.line1,
          x.label,
          x.isDefault,
        ]),
      ).toEqual([
        [true, 'billing', '12 MG Road', null, false],
        [true, 'shipping', 'Plot 7, MIDC', 'Main warehouse', true],
        [false, 'billing', '44 FC Road', null, true],
      ]);
      expect(await auditTrail(a.tenantId, 'parties', id)).toEqual([
        { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
        { action: 'UPDATE', changedBy: a.ownerUserId, oldVersion: 1, newVersion: 2 },
      ]);
      // The old default was cleared, then both kept addresses updated, then one inserted.
      const trail = await auditTrail(a.tenantId, 'party_addresses', billing?.id ?? '');
      expect(trail.map((r) => [r.action, r.newVersion])).toEqual([
        ['INSERT', 1],
        ['UPDATE', 2],
      ]);
    });

    it('drops addresses left out of the list', async () => {
      const current = partyResponseSchema.parse(
        (await a.client.get(`/parties/${id}`).expect(200)).body,
      );
      const keep = current.addresses.filter((x) => x.isDefault && x.kind === 'billing');
      const res = await a.client
        .patch(`/parties/${id}`, { addresses: keep, version: 2 })
        .expect(200);
      expect(partyResponseSchema.parse(res.body).addresses.map((x) => x.id)).toEqual(
        keep.map((x) => x.id),
      );
    });

    it('deactivates on DELETE (204)', async () => {
      await a.client.delete(`/parties/${id}`).expect(204);
      const party = partyResponseSchema.parse(
        (await a.client.get(`/parties/${id}`).expect(200)).body,
      );
      expect(party).toMatchObject({ isActive: false, version: 4 });
      const active = partyPage.parse(
        (await a.client.get('/parties?active=false').expect(200)).body,
      );
      expect(active.data.map((p) => p.id)).toEqual([id]);
    });
  });

  describe('rules (422)', () => {
    it('requires a GSTIN for regular, composition and SEZ, and none otherwise', async () => {
      expect(
        errorPaths(await a.client.post('/parties', regular({ code: 'R-1', gstin: null }))),
      ).toEqual(['gstin']);
      expect(
        errorPaths(
          await a.client.post(
            '/parties',
            regular({ code: 'R-2', gstRegistrationType: 'unregistered' }),
          ),
        ),
      ).toEqual(['gstin']);
    });

    it('matches the GSTIN to the default billing state and the PAN', async () => {
      const karnataka = gstinOf('29', gstin.slice(2, 12));
      expect(
        errorPaths(await a.client.post('/parties', regular({ code: 'R-3', gstin: karnataka }))),
      ).toEqual(['gstin']);
      expect(
        errorPaths(await a.client.post('/parties', regular({ code: 'R-4', pan: 'AAGCB7383J' }))),
      ).toEqual(['pan']);
    });

    it('needs exactly one default billing address and Indian addresses with state and PIN', async () => {
      expect(
        errorPaths(
          await a.client.post('/parties', regular({ code: 'R-5', addresses: [nashikShipping] })),
        ),
      ).toEqual(['addresses']);
      expect(
        errorPaths(
          await a.client.post(
            '/parties',
            regular({ code: 'R-6', addresses: [{ ...puneBilling, pincode: '4110' }] }),
          ),
        ),
      ).toEqual(['addresses.0.pincode']);
    });

    it('takes the credit limit as non-negative integer paise', async () => {
      expect(
        errorPaths(await a.client.post('/parties', regular({ code: 'R-7', creditLimit: '-1' }))),
      ).toEqual(['creditLimit']);
      expect(
        errorPaths(
          await a.client.post('/parties', regular({ code: 'R-8', creditLimit: '100.50' })),
        ),
      ).toEqual(['creditLimit']);
    });

    it('checks the merged record, address ids, duplicates and versions', async () => {
      const party = partyResponseSchema.parse(
        (
          await a.client
            .post('/parties', regular({ code: 'M-1', gstin: activeGstin('27') }))
            .expect(201)
        ).body,
      );
      const [billing] = party.addresses;
      const moved = {
        ...puneBilling,
        id: billing?.id,
        stateCode: '29',
        city: 'Bengaluru',
        pincode: '560025',
      };
      expect(
        errorPaths(
          await a.client.patch(`/parties/${party.id}`, { addresses: [moved], version: 1 }),
        ),
      ).toEqual(['gstin']);
      const foreign = { ...puneBilling, id: party.id };
      expect(
        errorPaths(
          await a.client.patch(`/parties/${party.id}`, { addresses: [foreign], version: 1 }),
        ),
      ).toEqual(['addresses.0.id']);
      expectProblem(
        await a.client.post('/parties', regular({ code: 'M-1', gstin: activeGstin('27') })),
        409,
        'ALREADY_EXISTS',
      );
      expectProblem(
        await a.client.patch(`/parties/${party.id}`, { name: 'Stale', version: 9 }),
        409,
        'VERSION_CONFLICT',
      );
    });
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.party:view');
    await (await a.as(view.allowed)).get('/parties').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/parties'), 403, 'FORBIDDEN');
    const create = rolesFor('masters.party:create');
    const body = regular({ code: 'P-1', gstin: activeGstin('27') });
    expectProblem(await (await a.as(create.denied)).post('/parties', body), 403, 'FORBIDDEN');
    const party = partyResponseSchema.parse(
      (await (await a.as(create.allowed)).post('/parties', body).expect(201)).body,
    );
    const edit = rolesFor('masters.party:edit');
    const patch = { name: 'Renamed', version: 1 };
    expectProblem(
      await (await a.as(edit.denied)).patch(`/parties/${party.id}`, patch),
      403,
      'FORBIDDEN',
    );
    await (await a.as(edit.allowed)).patch(`/parties/${party.id}`, patch).expect(200);
    const del = rolesFor('masters.party:delete');
    expectProblem(await (await a.as(del.denied)).delete(`/parties/${party.id}`), 403, 'FORBIDDEN');
    await (await a.as(del.allowed)).delete(`/parties/${party.id}`).expect(204);
  });

  it("keeps each tenant's parties to itself", async () => {
    const [aParty] = partyPage.parse(
      (await a.client.get('/parties?q=C-001').expect(200)).body,
    ).data;
    const id = aParty?.id ?? '';
    expectProblem(await b.client.get(`/parties/${id}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/parties/${id}`, { name: 'x', version: 4 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await b.client.delete(`/parties/${id}`), 404, 'NOT_FOUND');
    expect(partyPage.parse((await b.client.get('/parties').expect(200)).body).meta.total).toBe(0);
    // The same code is free in another tenant.
    await b.client.post('/parties', regular()).expect(201);
  });
});
