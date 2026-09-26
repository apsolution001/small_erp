import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { recordMetaShape, text, uuidSchema, versionSchema } from '../common/primitives.js';
import { activeFilterSchema } from './shared.js';

/** Maximum nesting (spec 02); the service enforces it because it needs the parent chain. */
export const ITEM_CATEGORY_MAX_DEPTH = 3;

const itemCategoryFields = {
  /** Null for a root category. Names are unique per parent. */
  parentId: uuidSchema.nullable(),
  name: text(100),
  isActive: z.boolean(),
};

export const itemCategoryResponseSchema = z.object({ ...recordMetaShape, ...itemCategoryFields });
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

export const itemCategoryCreateSchema = z.object({
  ...itemCategoryFields,
  parentId: itemCategoryFields.parentId.default(null),
  isActive: z.boolean().default(true),
});
export type ItemCategoryCreate = z.infer<typeof itemCategoryCreateSchema>;
export type ItemCategoryCreateInput = z.input<typeof itemCategoryCreateSchema>;

export const itemCategoryUpdateSchema = z
  .object(itemCategoryFields)
  .partial()
  .extend({ version: versionSchema });
export type ItemCategoryUpdate = z.infer<typeof itemCategoryUpdateSchema>;

export const itemCategoryListQuerySchema = paginationQuerySchema.extend({
  tree: z.stringbool().optional(),
  parentId: uuidSchema.optional(),
  active: activeFilterSchema,
});
export type ItemCategoryListQuery = z.infer<typeof itemCategoryListQuerySchema>;
