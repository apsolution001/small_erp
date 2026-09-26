import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type ItemCategoriesRepository } from './item-categories.repository.js';
import { type ItemCategoryRow } from './item-categories.schema.js';
import { ItemCategoriesService } from './item-categories.service.js';

function category(overrides: Partial<ItemCategoryRow> = {}): ItemCategoryRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    parentId: null,
    name: 'Steel',
    isActive: true,
    createdAt: new Date('2026-04-01T04:30:00.000Z'),
    createdBy: null,
    updatedAt: new Date('2026-04-01T04:30:00.000Z'),
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
}

const fieldErrors = (error: DomainError) => (error as ValidationError).errors;

describe('ItemCategoriesService', () => {
  const repo = {
    lockTree: vi.fn(),
    list: vi.fn(),
    listAll: vi.fn(),
    findById: vi.fn(),
    depthOf: vi.fn(),
    subtreeOf: vi.fn(),
    findActiveIds: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const service = new ItemCategoriesService(repo as unknown as ItemCategoriesRepository);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('adds a third level under a second-level parent, under the tree lock', async () => {
      const parent = category();
      repo.findById.mockResolvedValue(parent);
      repo.depthOf.mockResolvedValue(2);
      repo.insert.mockImplementation((values: object) => ({ ...category(), ...values }));
      const created = await service.create({ parentId: parent.id, name: 'Fe 500', isActive: true });
      expect(repo.lockTree).toHaveBeenCalled();
      expect(created).toMatchObject({ parentId: parent.id, name: 'Fe 500' });
    });

    it('refuses a fourth level (422 on parentId)', async () => {
      repo.findById.mockResolvedValue(category());
      repo.depthOf.mockResolvedValue(3);
      const error = await failure(
        service.create({ parentId: uuidv7(), name: 'Too deep', isActive: true }),
      );
      expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
      expect(fieldErrors(error)).toEqual([
        {
          path: 'parentId',
          message: 'Categories can be nested at most 3 levels deep',
          code: 'custom',
        },
      ]);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('refuses an unknown or inactive parent', async () => {
      repo.findById.mockResolvedValueOnce(undefined);
      expect(
        fieldErrors(
          await failure(service.create({ parentId: uuidv7(), name: 'X', isActive: true })),
        ),
      ).toMatchObject([{ path: 'parentId', message: 'The parent category does not exist' }]);
      repo.findById.mockResolvedValueOnce(category({ isActive: false }));
      expect(
        fieldErrors(
          await failure(service.create({ parentId: uuidv7(), name: 'X', isActive: true })),
        ),
      ).toMatchObject([{ path: 'parentId', message: 'Choose an active parent category' }]);
    });
  });

  describe('update', () => {
    it('refuses to move a category under its own subtree (cycle)', async () => {
      const self = category();
      const child = uuidv7();
      repo.findById.mockResolvedValue(self);
      repo.subtreeOf.mockResolvedValue({ ids: new Set([self.id, child]), height: 2 });
      const error = await failure(service.update(self.id, { parentId: child, version: 1 }));
      expect(fieldErrors(error)).toMatchObject([{ path: 'parentId' }]);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses a move that would push the subtree below the third level', async () => {
      const self = category();
      const target = category({ id: uuidv7() });
      repo.findById.mockImplementation((id: string) => (id === self.id ? self : target));
      repo.subtreeOf.mockResolvedValue({ ids: new Set([self.id]), height: 2 });
      repo.depthOf.mockResolvedValue(2);
      const error = await failure(service.update(self.id, { parentId: target.id, version: 1 }));
      expect(fieldErrors(error)).toMatchObject([{ path: 'parentId' }]);
    });

    it('moves a subtree that fits, and renames without touching the tree', async () => {
      const self = category();
      const target = category({ id: uuidv7() });
      repo.findById.mockImplementation((id: string) => (id === self.id ? self : target));
      repo.subtreeOf.mockResolvedValue({ ids: new Set([self.id]), height: 2 });
      repo.depthOf.mockResolvedValue(1);
      repo.update.mockResolvedValue({ ...self, parentId: target.id, version: 2 });
      await service.update(self.id, { parentId: target.id, version: 1 });
      expect(repo.update).toHaveBeenCalledWith(self.id, { parentId: target.id });

      vi.resetAllMocks();
      repo.findById.mockResolvedValue(self);
      repo.update.mockResolvedValue({ ...self, name: 'Metals', version: 2 });
      await service.update(self.id, { name: 'Metals', version: 1 });
      expect(repo.subtreeOf).not.toHaveBeenCalled();
    });

    it('refuses a stale version', async () => {
      repo.findById.mockResolvedValue(category({ version: 2 }));
      expect(await failure(service.update(uuidv7(), { name: 'X', version: 1 }))).toMatchObject({
        status: 409,
        code: 'VERSION_CONFLICT',
      });
    });
  });

  it('refuses to delete a category with children or items (409 IN_USE)', async () => {
    repo.delete.mockRejectedValue(
      new Error('Failed query', {
        cause: Object.assign(new Error('fk'), {
          code: '23503',
          severity: 'ERROR',
          constraint: 'item_categories_parent_fk',
        }),
      }),
    );
    expect(await failure(service.remove(uuidv7()))).toMatchObject({ status: 409, code: 'IN_USE' });
  });
});
