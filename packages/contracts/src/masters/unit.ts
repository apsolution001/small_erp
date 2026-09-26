import { UQC_CODES } from '@ekaro/core';
import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { recordMetaShape, text } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
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

/**
 * The whole unit. Units have no cross-field rules, but `PATCH /units/:id` still parses
 * `{ ...existing, ...patch }` with it, like every master, so a rule added later applies at once.
 */
export const unitRecordSchema = z.object(unitFields);
export type UnitRecord = z.output<typeof unitRecordSchema>;

export const unitResponseSchema = z.object({
  ...recordMetaShape,
  code: z.string(),
  name: z.string(),
  uqc: uqcSchema,
  decimalPlaces: z.int(),
  isActive: z.boolean(),
});
export type UnitResponse = z.infer<typeof unitResponseSchema>;

export const unitCreateSchema = z.strictObject({
  ...unitFields,
  decimalPlaces: unitFields.decimalPlaces.default(0),
  isActive: z.boolean().default(true),
});
export type UnitCreate = z.infer<typeof unitCreateSchema>;
export type UnitCreateInput = z.input<typeof unitCreateSchema>;

export const unitUpdateSchema = updateSchema(unitFields);
export type UnitUpdate = z.infer<typeof unitUpdateSchema>;

export const unitListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['code', 'name', 'createdAt']).optional(),
  active: activeFilterSchema,
});
export type UnitListQuery = z.infer<typeof unitListQuerySchema>;
