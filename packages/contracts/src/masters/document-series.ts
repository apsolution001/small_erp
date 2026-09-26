import {
  DOC_NUMBER_FIRST_CHAR_PATTERN,
  SERIES_CHARSET_PATTERN,
  SERIES_PADDING_MAX,
  SERIES_PADDING_MIN,
  SERIES_PREFIX_MAX_LENGTH,
  SERIES_SUFFIX_MAX_LENGTH,
  type SeriesIssue,
  validateSeries,
} from '@ekaro/core';
import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { fyLabelSchema, recordMetaShape, uuidSchema } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { docTypeSchema } from './doc-types.js';

/** Prefix or suffix: upper-cased on input (so numbers are unique case-insensitively). */
const affix = (max: number) =>
  z
    .string()
    .toUpperCase()
    .max(max)
    .regex(SERIES_CHARSET_PATTERN, 'Use only letters, digits, / and -');

const prefixSchema = affix(SERIES_PREFIX_MAX_LENGTH).refine(
  (prefix) => prefix === '' || DOC_NUMBER_FIRST_CHAR_PATTERN.test(prefix),
  'Start with a letter or a digit from 1 to 9',
);

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
  prefix: prefixSchema,
  suffix: affix(SERIES_SUFFIX_MAX_LENGTH),
  padding: z.int().min(SERIES_PADDING_MIN).max(SERIES_PADDING_MAX),
  /** Can only increase, and only while nothing is issued (enforced by the service). */
  nextNumber: seriesNumberSchema,
  /** One default per (branch, doc type, FY). */
  isDefault: z.boolean(),
};

const seriesRecordObject = z.object(seriesFields);
type SeriesRuleInput = z.output<typeof seriesRecordObject>;

/** The series-level issues; lengths and characters are already checked per field. */
const seriesRuleMessage = (issue: SeriesIssue): string | undefined => {
  if (issue.code === 'NUMBER_TOO_LONG') {
    return 'Document numbers in this series would exceed 16 characters';
  }
  if (issue.code === 'INVALID_FIRST_CHARACTER' && issue.field === 'padding') {
    return 'Without a prefix, numbers must not start with 0: lower the padding';
  }
  return undefined;
};

/**
 * GST rule 46 and the e-invoice schema, via `validateSeries` from core: the widest number the
 * series renders from `nextNumber` on fits in 16 characters, and the first rendered character
 * is a letter or 1–9. The per-field schemas already check lengths and characters.
 */
const seriesRules = (value: SeriesRuleInput, ctx: z.RefinementCtx): void => {
  const { prefix, suffix, padding, nextNumber } = value;
  for (const issue of validateSeries({ prefix, suffix, padding, nextNumber: BigInt(nextNumber) })) {
    const message = seriesRuleMessage(issue);
    if (message !== undefined) ctx.addIssue({ code: 'custom', path: [issue.field], message });
  }
};

/** The whole series with its rules. The service parses `{ ...existing, ...patch }` with it. */
export const documentSeriesRecordSchema = seriesRecordObject.superRefine(seriesRules);
export type DocumentSeriesRecord = z.output<typeof documentSeriesRecordSchema>;

export const documentSeriesResponseSchema = z.object({
  ...recordMetaShape,
  branchId: uuidSchema,
  docType: docTypeSchema,
  fy: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  padding: z.int(),
  nextNumber: z.string(),
  isDefault: z.boolean(),
});
export type DocumentSeriesResponse = z.infer<typeof documentSeriesResponseSchema>;

export const documentSeriesCreateSchema = z
  .strictObject({
    ...seriesFields,
    suffix: seriesFields.suffix.default(''),
    padding: seriesFields.padding.default(4),
    nextNumber: seriesNumberSchema.default('1'),
    isDefault: z.boolean().default(false),
  })
  .superRefine(seriesRules);
export type DocumentSeriesCreate = z.infer<typeof documentSeriesCreateSchema>;
export type DocumentSeriesCreateInput = z.input<typeof documentSeriesCreateSchema>;

/**
 * `PATCH /document-series/:id`. Branch, document type and FY identify a series and are rejected.
 * The service allows changing `nextNumber`, `prefix`, `suffix` and `padding` only while the
 * series has issued nothing (spec 02).
 */
export const documentSeriesUpdateSchema = updateSchema({
  prefix: seriesFields.prefix,
  suffix: seriesFields.suffix,
  padding: seriesFields.padding,
  nextNumber: seriesFields.nextNumber,
  isDefault: seriesFields.isDefault,
});
export type DocumentSeriesUpdate = z.infer<typeof documentSeriesUpdateSchema>;

export const documentSeriesListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['docType', 'fy', 'prefix', 'createdAt']).optional(),
  branchId: uuidSchema.optional(),
  docType: docTypeSchema.optional(),
  fy: fyLabelSchema.optional(),
});
export type DocumentSeriesListQuery = z.infer<typeof documentSeriesListQuerySchema>;
