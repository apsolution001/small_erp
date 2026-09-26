import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { recordMetaShape, text, uuidSchema } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { activeFilterSchema } from './shared.js';

const godownFields = {
  branchId: uuidSchema,
  code: text(10),
  name: text(100),
  address: text(300).nullable(),
  allowNegativeStock: z.boolean(),
  isActive: z.boolean(),
};

/**
 * The whole godown. `PATCH /godowns/:id` parses `{ ...existing, ...patch }` with it; the branch
 * rules need the branch, so the service checks them.
 */
export const godownRecordSchema = z.object(godownFields);
export type GodownRecord = z.output<typeof godownRecordSchema>;

export const godownResponseSchema = z.object({
  ...recordMetaShape,
  branchId: uuidSchema,
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  allowNegativeStock: z.boolean(),
  isActive: z.boolean(),
});
export type GodownResponse = z.infer<typeof godownResponseSchema>;

export const godownCreateSchema = z.strictObject({
  ...godownFields,
  address: godownFields.address.default(null),
  allowNegativeStock: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type GodownCreate = z.infer<typeof godownCreateSchema>;
export type GodownCreateInput = z.input<typeof godownCreateSchema>;

export const godownUpdateSchema = updateSchema(godownFields);
export type GodownUpdate = z.infer<typeof godownUpdateSchema>;

export const godownListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['code', 'name', 'createdAt']).optional(),
  branchId: uuidSchema.optional(),
  active: activeFilterSchema,
});
export type GodownListQuery = z.infer<typeof godownListQuerySchema>;
