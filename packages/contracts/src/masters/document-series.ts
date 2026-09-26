import {
  SERIES_CHARSET_PATTERN,
  SERIES_PADDING_MAX,
  SERIES_PADDING_MIN,
  SERIES_PREFIX_MAX_LENGTH,
  SERIES_SUFFIX_MAX_LENGTH,
  validateSeries,
} from '@ekaro/core';
import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { fyLabelSchema, recordMetaShape, uuidSchema, versionSchema } from '../common/primitives.js';
import { docTypeSchema } from './doc-types.js';

const affix = (max: number) =>
  z.string().max(max).regex(SERIES_CHARSET_PATTERN, 'Use only letters, digits, / and -');

/**
 * The next number as a string: `next_number` is a `bigint`, and a 16-character document number
 * can exceed `Number.MAX_SAFE_INTEGER`.
 */
export const seriesNumberSchema = z
  .string()
  .regex(/^[1-9]\d{0,15}$/, 'Expected a whole number from 1');

const seriesFields = {
  branchId: uuidSchema,
  docType: docTypeSchema,
  fy: fyLabelSchema,
  prefix: affix(SERIES_PREFIX_MAX_LENGTH),
  suffix: affix(SERIES_SUFFIX_MAX_LENGTH),
  padding: z.int().min(SERIES_PADDING_MIN).max(SERIES_PADDING_MAX),
  /** Can only increase (enforced by the service). */
  nextNumber: seriesNumberSchema,
  /** One default per (branch, doc type, FY). */
  isDefault: z.boolean(),
};

interface SeriesRuleInput {
  prefix?: string | undefined;
  suffix?: string | undefined;
  padding?: number | undefined;
  nextNumber?: string | undefined;
}

/**
 * GST rule 46: every number the series can render must fit in 16 characters. Needs prefix,
 * suffix and padding together; the per-field schemas above already check length and charset.
 */
const seriesRules = (value: SeriesRuleInput, ctx: z.RefinementCtx): void => {
  const { prefix, suffix, padding, nextNumber } = value;
  if (prefix === undefined || suffix === undefined || padding === undefined) return;
  const issues = validateSeries({
    prefix,
    suffix,
    padding,
    ...(nextNumber === undefined ? {} : { nextNumber: BigInt(nextNumber) }),
  });
  for (const issue of issues.filter((i) => i.code === 'NUMBER_TOO_LONG')) {
    ctx.addIssue({
      code: 'custom',
      path: [issue.field],
      message: 'Document numbers in this series would exceed 16 characters',
    });
  }
};

export const documentSeriesResponseSchema = z.object({ ...recordMetaShape, ...seriesFields });
export type DocumentSeriesResponse = z.infer<typeof documentSeriesResponseSchema>;

export const documentSeriesCreateSchema = z
  .object({
    ...seriesFields,
    suffix: seriesFields.suffix.default(''),
    padding: seriesFields.padding.default(4),
    nextNumber: seriesNumberSchema.default('1'),
    isDefault: z.boolean().default(false),
  })
  .superRefine(seriesRules);
export type DocumentSeriesCreate = z.infer<typeof documentSeriesCreateSchema>;
export type DocumentSeriesCreateInput = z.input<typeof documentSeriesCreateSchema>;

/** Branch, document type and FY identify a series and cannot change. */
export const documentSeriesUpdateSchema = z
  .object({
    prefix: seriesFields.prefix,
    suffix: seriesFields.suffix,
    padding: seriesFields.padding,
    nextNumber: seriesFields.nextNumber,
    isDefault: seriesFields.isDefault,
  })
  .partial()
  .extend({ version: versionSchema })
  .superRefine(seriesRules);
export type DocumentSeriesUpdate = z.infer<typeof documentSeriesUpdateSchema>;

export const documentSeriesListQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  docType: docTypeSchema.optional(),
  fy: fyLabelSchema.optional(),
});
export type DocumentSeriesListQuery = z.infer<typeof documentSeriesListQuerySchema>;
