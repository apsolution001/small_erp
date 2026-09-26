import { UQC_CODES } from '@ekaro/core';
import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { recordMetaShape, text, versionSchema } from '../common/primitives.js';
import { activeFilterSchema } from './shared.js';

export const uqcSchema = z.enum(UQC_CODES);

const unitFields = {
  /** Upper-case, at most 10 characters, unique per tenant. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,9}$/, 'Use up to 10 letters, digits or -'),
  name: text(50),
  /** The GST unit quantity code reported in GSTR-1 and e-invoices. */
  uqc: uqcSchema,
  decimalPlaces: z.int().min(0).max(6),
  isActive: z.boolean(),
};

export const unitResponseSchema = z.object({ ...recordMetaShape, ...unitFields });
export type UnitResponse = z.infer<typeof unitResponseSchema>;

export const unitCreateSchema = z.object({
  ...unitFields,
  decimalPlaces: unitFields.decimalPlaces.default(0),
  isActive: z.boolean().default(true),
});
export type UnitCreate = z.infer<typeof unitCreateSchema>;
export type UnitCreateInput = z.input<typeof unitCreateSchema>;

export const unitUpdateSchema = z.object(unitFields).partial().extend({ version: versionSchema });
export type UnitUpdate = z.infer<typeof unitUpdateSchema>;

export const unitListQuerySchema = paginationQuerySchema.extend({ active: activeFilterSchema });
export type UnitListQuery = z.infer<typeof unitListQuerySchema>;
