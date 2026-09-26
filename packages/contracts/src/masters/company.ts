import { z } from 'zod';
import {
  emailSchema,
  gstinSchema,
  isoDateSchema,
  panSchema,
  phoneSchema,
  text,
  timestampSchema,
  versionSchema,
} from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { checkGstinConsistency, indianAddressResponseShape, indianAddressShape } from './shared.js';

export const VALUATION_METHODS = ['fifo', 'weighted_average'] as const;
export const valuationMethodSchema = z.enum(VALUATION_METHODS);
export type ValuationMethod = z.infer<typeof valuationMethodSchema>;

/** Minimum HSN digits: 4 up to ₹5 crore turnover, 6 above it. */
export const hsnMinDigitsSchema = z.union([z.literal(4), z.literal(6)]);

const companyFields = {
  legalName: text(200),
  tradeName: text(200).nullable(),
  /** Null for an unregistered business. */
  gstin: gstinSchema.nullable(),
  pan: panSchema.nullable(),
  ...indianAddressShape,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  /** Locked after the first posting (enforced by the T-106 and Sprint 2 services). */
  booksBeginDate: isoDateSchema,
  /** Locked after the first posting (enforced by the T-106 and Sprint 2 services). */
  valuationMethod: valuationMethodSchema,
  allowNegativeStock: z.boolean(),
  roundOffSales: z.boolean(),
  hsnMinDigits: hsnMinDigitsSchema,
  eInvoiceEnabled: z.boolean(),
};

const companyRecordObject = z.object(companyFields);
type CompanyRuleInput = z.output<typeof companyRecordObject>;

/** The GSTIN is registered in the company's state, and its PAN is the company's PAN. */
const companyRules = (value: CompanyRuleInput, ctx: z.RefinementCtx): void => {
  checkGstinConsistency(value, ctx);
};

/**
 * The whole company profile with its cross-field rules. `PATCH /company` parses
 * `companyRecordSchema.parse({ ...existing, ...patch })` before saving.
 */
export const companyRecordSchema = companyRecordObject.superRefine(companyRules);
export type CompanyRecord = z.output<typeof companyRecordSchema>;

/** `GET /company`. One profile per tenant, keyed by the tenant, so it has no `id`. */
export const companyResponseSchema = z.object({
  legalName: z.string(),
  tradeName: z.string().nullable(),
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  ...indianAddressResponseShape,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  booksBeginDate: isoDateSchema,
  valuationMethod: valuationMethodSchema,
  allowNegativeStock: z.boolean(),
  roundOffSales: z.boolean(),
  hsnMinDigits: hsnMinDigitsSchema,
  eInvoiceEnabled: z.boolean(),
  logoObjectKey: z.string().nullable(),
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CompanyResponse = z.infer<typeof companyResponseSchema>;

/** Used by the tenant bootstrap (signup), not exposed as an HTTP route. */
export const companyCreateSchema = z
  .strictObject({
    ...companyFields,
    tradeName: companyFields.tradeName.default(null),
    line2: companyFields.line2.default(null),
    email: companyFields.email.default(null),
    phone: companyFields.phone.default(null),
    valuationMethod: valuationMethodSchema.default('weighted_average'),
    allowNegativeStock: z.boolean().default(false),
    roundOffSales: z.boolean().default(true),
    hsnMinDigits: hsnMinDigitsSchema.default(4),
    eInvoiceEnabled: z.boolean().default(false),
  })
  .superRefine(companyRules);
export type CompanyCreate = z.infer<typeof companyCreateSchema>;
export type CompanyCreateInput = z.input<typeof companyCreateSchema>;

/** `PATCH /company`. */
export const companyUpdateSchema = updateSchema(companyFields);
export type CompanyUpdate = z.infer<typeof companyUpdateSchema>;
