import { Decimal } from '@ekaro/core';
import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { percentSchema, recordMetaShape, text, versionSchema } from '../common/primitives.js';
import { activeFilterSchema } from './shared.js';

const isZero = (pct: string): boolean => new Decimal(pct).isZero();

const taxRateFields = {
  name: text(50),
  /** Total GST rate. CGST = SGST = rate / 2 and IGST = rate are derived, never stored. */
  gstRate: percentSchema,
  cessRate: percentSchema,
  isExempt: z.boolean(),
  isNilRated: z.boolean(),
  isNonGst: z.boolean(),
  isActive: z.boolean(),
};

/** Every field optional: the rules run on creates and on partial updates alike. */
const taxRatePatchSchema = z.object(taxRateFields).partial();
type TaxRateRuleInput = z.output<typeof taxRatePatchSchema>;

/**
 * GST rate ≤ 100. Exempt, nil-rated and non-GST are mutually exclusive, and such a slab carries
 * no GST or cess.
 */
const taxRateRules = (value: TaxRateRuleInput, ctx: z.RefinementCtx): void => {
  if (value.gstRate !== undefined && new Decimal(value.gstRate).greaterThan(100)) {
    ctx.addIssue({ code: 'custom', path: ['gstRate'], message: 'GST rate cannot exceed 100%' });
  }
  const flags = (['isExempt', 'isNilRated', 'isNonGst'] as const).filter((f) => value[f] === true);
  for (const extra of flags.slice(1)) {
    ctx.addIssue({
      code: 'custom',
      path: [extra],
      message: 'Choose only one of exempt, nil-rated or non-GST',
    });
  }
  if (flags.length === 0) return;
  for (const field of ['gstRate', 'cessRate'] as const) {
    const pct = value[field];
    if (pct !== undefined && !isZero(pct)) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'An exempt, nil-rated or non-GST slab has no tax',
      });
    }
  }
};

export const taxRateResponseSchema = z.object({ ...recordMetaShape, ...taxRateFields });
export type TaxRateResponse = z.infer<typeof taxRateResponseSchema>;

export const taxRateCreateSchema = z
  .object({
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

export const taxRateUpdateSchema = taxRatePatchSchema
  .extend({ version: versionSchema })
  .superRefine(taxRateRules);
export type TaxRateUpdate = z.infer<typeof taxRateUpdateSchema>;

export const taxRateListQuerySchema = paginationQuerySchema.extend({ active: activeFilterSchema });
export type TaxRateListQuery = z.infer<typeof taxRateListQuerySchema>;
