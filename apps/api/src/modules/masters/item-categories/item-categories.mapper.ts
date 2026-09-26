import { type ItemCategoryResponse } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type ItemCategoryRow } from './item-categories.schema.js';

export function toItemCategoryResponse(row: ItemCategoryRow): ItemCategoryResponse {
  return {
    ...recordMetaOf(row),
    parentId: row.parentId,
    name: row.name,
    isActive: row.isActive,
  };
}
