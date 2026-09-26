import {
  ITEM_CATEGORY_MAX_DEPTH,
  type ItemCategoryCreate,
  type ItemCategoryListQuery,
  itemCategoryRecordSchema,
  type ItemCategoryResponse,
  type ItemCategoryTreeNode,
  type ItemCategoryUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import {
  type ConstraintErrors,
  deleteUnlessReferenced,
  mapConstraintErrors,
} from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { toItemCategoryResponse } from './item-categories.mapper.js';
import { ItemCategoriesRepository } from './item-categories.repository.js';
import { type ItemCategoryRow } from './item-categories.schema.js';
import { buildCategoryTree, fitsDepth } from './item-categories.tree.js';

const constraintErrors = (name: string): ConstraintErrors => ({
  item_categories_name_per_parent: () =>
    new ConflictError('ALREADY_EXISTS', `A category named ${name} already exists at this level.`),
});

const tooDeep = (): ValidationError =>
  ValidationError.forField(
    'parentId',
    `Categories can be nested at most ${ITEM_CATEGORY_MAX_DEPTH} levels deep`,
  );

/**
 * Item categories (spec 02 §2–3): a tree at most 3 levels deep, names unique per parent. Every
 * change to the tree's shape runs under a tenant lock, so two concurrent moves cannot together
 * create a cycle or a fourth level. Unused categories are deleted; a category with children or
 * items is 409 `IN_USE`.
 */
@Injectable()
export class ItemCategoriesService {
  constructor(private readonly categories: ItemCategoriesRepository) {}

  async list(query: ItemCategoryListQuery): Promise<Page<ItemCategoryResponse>> {
    const { rows, total } = await this.categories.list(query);
    return pageOf(rows.map(toItemCategoryResponse), total, query);
  }

  /** The whole forest (`?tree=true`); with `active` only that subset, subtrees included. */
  async tree(active: boolean | undefined): Promise<ItemCategoryTreeNode[]> {
    return buildCategoryTree(await this.categories.listAll(active));
  }

  async get(id: string): Promise<ItemCategoryResponse> {
    return toItemCategoryResponse(await this.require(id));
  }

  async create(input: ItemCategoryCreate): Promise<ItemCategoryResponse> {
    await this.categories.lockTree();
    if (input.parentId !== null) await this.assertParent(input.parentId, 1);
    const row = await mapConstraintErrors(
      () => this.categories.insert(input),
      constraintErrors(input.name),
    );
    return toItemCategoryResponse(row);
  }

  async update(id: string, patch: ItemCategoryUpdate): Promise<ItemCategoryResponse> {
    await this.categories.lockTree();
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    const merged = parseMergedRecord(
      itemCategoryRecordSchema,
      toItemCategoryResponse(existing),
      changes,
    );
    if (merged.parentId !== null && merged.parentId !== existing.parentId) {
      const subtree = await this.categories.subtreeOf(id);
      if (subtree.ids.has(merged.parentId)) {
        throw ValidationError.forField(
          'parentId',
          'A category cannot be moved under itself or one of its subcategories',
        );
      }
      await this.assertParent(merged.parentId, subtree.height);
    }
    const row = await mapConstraintErrors(
      () => this.categories.update(id, changes),
      constraintErrors(merged.name),
    );
    return toItemCategoryResponse(row);
  }

  async remove(id: string): Promise<void> {
    const deleted = await deleteUnlessReferenced(() => this.categories.delete(id), 'category');
    if (!deleted) throw notFound();
  }

  /** The active categories among `ids`, for items that start using a category. */
  findActiveIds(ids: readonly string[]): Promise<Set<string>> {
    return this.categories.findActiveIds(ids);
  }

  /** The parent exists, is active, and has room for a subtree `height` levels tall below it. */
  private async assertParent(parentId: string, height: number): Promise<void> {
    const parent = await this.categories.findById(parentId);
    if (parent === undefined) {
      throw ValidationError.forField('parentId', 'The parent category does not exist');
    }
    if (!parent.isActive) {
      throw ValidationError.forField('parentId', 'Choose an active parent category');
    }
    if (!fitsDepth(await this.categories.depthOf(parentId), height)) throw tooDeep();
  }

  private async require(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<ItemCategoryRow> {
    const row = await this.categories.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Category not found.');
