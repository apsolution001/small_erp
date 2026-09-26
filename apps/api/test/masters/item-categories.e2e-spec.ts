import {
  itemCategoryResponseSchema,
  itemCategoryTreeNodeSchema,
  paginated,
} from '@ekaro/contracts';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp } from '../support/app.js';
import {
  auditTrail,
  createTenant,
  errorPaths,
  expectProblem,
  rolesFor,
  type TestTenant,
} from '../support/masters.js';

const categoryPage = paginated(itemCategoryResponseSchema);
const forest = z.array(itemCategoryTreeNodeSchema);

describe('item categories API (spec 02: a tree at most 3 levels deep)', () => {
  let app: NestExpressApplication;
  let a: TestTenant;
  let b: TestTenant;

  const create = async (tenant: TestTenant, name: string, parentId: string | null = null) =>
    itemCategoryResponseSchema.parse(
      (await tenant.client.post('/item-categories', { name, parentId }).expect(201)).body,
    );

  beforeAll(async () => {
    app = await createTestApp();
    [a, b] = await Promise.all([createTenant(app), createTenant(app)]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the tree', () => {
    let steel = '';
    let bars = '';
    let fe500 = '';

    it('builds three levels and returns them nested with ?tree=true', async () => {
      steel = (await create(a, 'Steel')).id;
      bars = (await create(a, 'TMT bars', steel)).id;
      fe500 = (await create(a, 'Fe 500', bars)).id;
      await create(a, 'Aluminium');
      const tree = forest.parse(
        (await a.client.get('/item-categories?tree=true').expect(200)).body,
      );
      expect(tree.map((n) => n.name)).toEqual(['Aluminium', 'Steel']);
      expect(tree[1]?.children[0]).toMatchObject({
        id: bars,
        name: 'TMT bars',
        children: [{ id: fe500, name: 'Fe 500', parentId: bars, children: [] }],
      });
    });

    it('refuses a fourth level (422 on parentId)', async () => {
      const res = await a.client.post('/item-categories', { name: 'Too deep', parentId: fe500 });
      expect(errorPaths(res)).toEqual(['parentId']);
    });

    it('refuses to move a category under its own subtree, or too deep', async () => {
      const cycle = await a.client.patch(`/item-categories/${steel}`, {
        parentId: fe500,
        version: 1,
      });
      expect(errorPaths(cycle)).toEqual(['parentId']);
      const other = await create(a, 'Other');
      const deep = await a.client.patch(`/item-categories/${bars}`, {
        parentId: other.id,
        version: 1,
      });
      // bars has a child, so under a root it would reach 3 levels: that fits.
      expect(deep.status).toBe(200);
      const tooDeep = await a.client.patch(`/item-categories/${other.id}`, {
        parentId: fe500,
        version: 1,
      });
      expect(errorPaths(tooDeep)).toEqual(['parentId']);
    });

    it('lists flat pages filtered by parent, sorted by name', async () => {
      const children = categoryPage.parse(
        (await a.client.get(`/item-categories?parentId=${bars}`).expect(200)).body,
      );
      expect(children.data.map((c) => c.name)).toEqual(['Fe 500']);
      const all = categoryPage.parse(
        (await a.client.get('/item-categories?sort=name:desc&pageSize=2').expect(200)).body,
      );
      expect(all.meta.total).toBe(5);
      expect(all.data.map((c) => c.name)).toEqual(['TMT bars', 'Steel']);
    });

    it('hides inactive branches from the active tree', async () => {
      await a.client.patch(`/item-categories/${bars}`, { isActive: false, version: 2 }).expect(200);
      const tree = forest.parse(
        (await a.client.get('/item-categories?tree=true&active=true').expect(200)).body,
      );
      const names = JSON.stringify(tree);
      expect(names).not.toContain('TMT bars');
      expect(names).not.toContain('Fe 500');
      expect(
        errorPaths(await a.client.post('/item-categories', { name: 'X', parentId: bars })),
      ).toEqual(['parentId']);
    });

    it('refuses duplicate names at one level, case-insensitively (409)', async () => {
      const res = await a.client.post('/item-categories', { name: 'steel' });
      expectProblem(res, 409, 'ALREADY_EXISTS');
      // The same name under another parent is fine.
      await create(a, 'Steel', (await create(a, 'Scrap')).id);
    });

    it('refuses to delete a category with children (409 IN_USE), deletes a leaf', async () => {
      expectProblem(await a.client.delete(`/item-categories/${bars}`), 409, 'IN_USE');
      await a.client.delete(`/item-categories/${fe500}`).expect(204);
      expect(await auditTrail(a.tenantId, 'item_categories', fe500)).toEqual([
        { action: 'INSERT', changedBy: a.ownerUserId, oldVersion: null, newVersion: 1 },
        { action: 'DELETE', changedBy: a.ownerUserId, oldVersion: 1, newVersion: null },
      ]);
    });

    it('refuses a stale version', async () => {
      expectProblem(
        await a.client.patch(`/item-categories/${steel}`, { name: 'Metals', version: 9 }),
        409,
        'VERSION_CONFLICT',
      );
    });
  });

  it('allows and denies by permission', async () => {
    const view = rolesFor('masters.item_category:view');
    await (await a.as(view.allowed)).get('/item-categories').expect(200);
    expectProblem(await (await a.as(view.denied)).get('/item-categories'), 403, 'FORBIDDEN');
    const createPerm = rolesFor('masters.item_category:create');
    expectProblem(
      await (await a.as(createPerm.denied)).post('/item-categories', { name: 'P' }),
      403,
      'FORBIDDEN',
    );
    const created = itemCategoryResponseSchema.parse(
      (await (await a.as(createPerm.allowed)).post('/item-categories', { name: 'P' }).expect(201))
        .body,
    );
    const edit = rolesFor('masters.item_category:edit');
    expectProblem(
      await (
        await a.as(edit.denied)
      ).patch(`/item-categories/${created.id}`, {
        name: 'Q',
        version: 1,
      }),
      403,
      'FORBIDDEN',
    );
    await (
      await a.as(edit.allowed)
    )
      .patch(`/item-categories/${created.id}`, { name: 'Q', version: 1 })
      .expect(200);
    const del = rolesFor('masters.item_category:delete');
    expectProblem(
      await (await a.as(del.denied)).delete(`/item-categories/${created.id}`),
      403,
      'FORBIDDEN',
    );
    await (await a.as(del.allowed)).delete(`/item-categories/${created.id}`).expect(204);
  });

  it("keeps each tenant's categories to itself, including as a parent", async () => {
    const aRoot = await create(a, 'Isolated');
    expectProblem(await b.client.get(`/item-categories/${aRoot.id}`), 404, 'NOT_FOUND');
    expectProblem(
      await b.client.patch(`/item-categories/${aRoot.id}`, { name: 'x', version: 1 }),
      404,
      'NOT_FOUND',
    );
    expectProblem(await b.client.delete(`/item-categories/${aRoot.id}`), 404, 'NOT_FOUND');
    expect(
      errorPaths(await b.client.post('/item-categories', { name: 'Child', parentId: aRoot.id })),
    ).toEqual(['parentId']);
    expect(
      forest.parse((await b.client.get('/item-categories?tree=true').expect(200)).body),
    ).toEqual([]);
  });
});
