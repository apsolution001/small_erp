import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { recordMetaShape, text, uuidSchema, versionSchema } from '../common/primitives.js';
import { activeFilterSchema } from './shared.js';

const godownFields = {
  branchId: uuidSchema,
  code: text(10),
  name: text(100),
  address: text(300).nullable(),
  allowNegativeStock: z.boolean(),
  isActive: z.boolean(),
};

export const godownResponseSchema = z.object({ ...recordMetaShape, ...godownFields });
export type GodownResponse = z.infer<typeof godownResponseSchema>;

export const godownCreateSchema = z.object({
  ...godownFields,
  address: godownFields.address.default(null),
  allowNegativeStock: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type GodownCreate = z.infer<typeof godownCreateSchema>;
export type GodownCreateInput = z.input<typeof godownCreateSchema>;

export const godownUpdateSchema = z
  .object(godownFields)
  .partial()
  .extend({ version: versionSchema });
export type GodownUpdate = z.infer<typeof godownUpdateSchema>;

export const godownListQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  active: activeFilterSchema,
});
export type GodownListQuery = z.infer<typeof godownListQuerySchema>;
