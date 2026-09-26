import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { recordMetaShape, text, uuidSchema } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { activeFilterSchema } from './shared.js';

/** Maximum nesting (spec 02); the service enforces it because it needs the parent chain. */
export const ITEM_CATEGORY_MAX_DEPTH = 3;

const itemCategoryFields = {
  /** Null for a root category. Names are unique per parent. */
  parentId: uuidSchema.nullable(),
  name: text(100),
  isActive: z.boolean(),
};

/**
 * The whole category. `PATCH /item-categories/:id` parses `{ ...existing, ...patch }` with it; the
 * depth and cycle rules need the tree, so the service checks them.
 */
export const itemCategoryRecordSchema = z.object(itemCategoryFields);
export type ItemCategoryRecord = z.output<typeof itemCategoryRecordSchema>;

export const itemCategoryResponseSchema = z.object({
  ...recordMetaShape,
  parentId: uuidSchema.nullable(),
  name: z.string(),
  isActive: z.boolean(),
});
export type ItemCategoryResponse = z.infer<typeof itemCategoryResponseSchema>;

export interface ItemCategoryTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  isActive: boolean;
  children: ItemCategoryTreeNode[];
}

/** One node of `GET /item-categories?tree=true`. */
export const itemCategoryTreeNodeSchema: z.ZodType<ItemCategoryTreeNode> = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  name: z.string(),
  isActive: z.boolean(),
  get children() {
    return z.array(itemCategoryTreeNodeSchema);
  },
});

export const itemCategoryCreateSchema = z.strictObject({
  ...itemCategoryFields,
  parentId: itemCategoryFields.parentId.default(null),
  isActive: z.boolean().default(true),
});
export type ItemCategoryCreate = z.infer<typeof itemCategoryCreateSchema>;
export type ItemCategoryCreateInput = z.input<typeof itemCategoryCreateSchema>;

export const itemCategoryUpdateSchema = updateSchema(itemCategoryFields);
export type ItemCategoryUpdate = z.infer<typeof itemCategoryUpdateSchema>;

export const itemCategoryListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['name', 'createdAt']).optional(),
  tree: z.stringbool().optional(),
  parentId: uuidSchema.optional(),
  active: activeFilterSchema,
});
export type ItemCategoryListQuery = z.infer<typeof itemCategoryListQuerySchema>;
