import { Decimal } from '@ekaro/core';
import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { percentSchema, recordMetaShape, text } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { activeFilterSchema } from './shared.js';

const taxRateFields = {
  name: text(50),
  /** Total GST rate. CGST = SGST = rate / 2 and IGST = rate are derived, never stored. */
  gstRate: percentSchema,
  /** Ad-valorem compensation cess only (accounting standard). */
  cessRate: percentSchema,
  isExempt: z.boolean(),
  isNilRated: z.boolean(),
  isNonGst: z.boolean(),
  isActive: z.boolean(),
};

const taxRateRecordObject = z.object(taxRateFields);
type TaxRateRuleInput = z.output<typeof taxRateRecordObject>;

/**
 * GST rate ≤ 100. Exempt, nil-rated and non-GST are mutually exclusive, and such a slab carries
 * no GST or cess.
 */
const taxRateRules = (value: TaxRateRuleInput, ctx: z.RefinementCtx): void => {
  if (new Decimal(value.gstRate).greaterThan(100)) {
    ctx.addIssue({ code: 'custom', path: ['gstRate'], message: 'GST rate cannot exceed 100%' });
  }
  const flags = (['isExempt', 'isNilRated', 'isNonGst'] as const).filter((f) => value[f]);
  for (const extra of flags.slice(1)) {
    ctx.addIssue({
      code: 'custom',
      path: [extra],
      message: 'Choose only one of exempt, nil-rated or non-GST',
    });
  }
  if (flags.length === 0) return;
  for (const field of ['gstRate', 'cessRate'] as const) {
    if (!new Decimal(value[field]).isZero()) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'An exempt, nil-rated or non-GST slab has no tax',
      });
    }
  }
};

/** The whole slab with its rules. The service parses `{ ...existing, ...patch }` with it. */
export const taxRateRecordSchema = taxRateRecordObject.superRefine(taxRateRules);
export type TaxRateRecord = z.output<typeof taxRateRecordSchema>;

export const taxRateResponseSchema = z.object({
  ...recordMetaShape,
  name: z.string(),
  gstRate: percentSchema,
  cessRate: percentSchema,
  isExempt: z.boolean(),
  isNilRated: z.boolean(),
  isNonGst: z.boolean(),
  isActive: z.boolean(),
});
export type TaxRateResponse = z.infer<typeof taxRateResponseSchema>;

export const taxRateCreateSchema = z
  .strictObject({
    ...taxRateFields,
    cessRate: percentSchema.default('0'),
    isExempt: z.boolean().default(false),
    isNilRated: z.boolean().default(false),
    isNonGst: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine(taxRateRules);
export type TaxRateCreate = z.infer<typeof taxRateCreateSchema>;
export type TaxRateCreateInput = z.input<typeof taxRateCreateSchema>;

/**
 * `PATCH /tax-rates/:id`: only the name and the active flag. A slab's rates and flags are
 * immutable, because documents already reference it. A rate change is a new slab plus an
 * effective-dated `item_tax_rates` row (`POST /items/:id/tax-rates`).
 */
export const taxRateUpdateSchema = updateSchema({
  name: taxRateFields.name,
  isActive: taxRateFields.isActive,
});
export type TaxRateUpdate = z.infer<typeof taxRateUpdateSchema>;

export const taxRateListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['name', 'gstRate', 'createdAt']).optional(),
  active: activeFilterSchema,
});
export type TaxRateListQuery = z.infer<typeof taxRateListQuerySchema>;
