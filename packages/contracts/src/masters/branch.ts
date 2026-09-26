import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { gstinSchema, recordMetaShape, text } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import {
  activeFilterSchema,
  checkGstinConsistency,
  indianAddressResponseShape,
  indianAddressShape,
} from './shared.js';

const branchFields = {
  code: text(10),
  name: text(100),
  /** A branch in another state has its own GSTIN, registered in the branch's state. */
  gstin: gstinSchema.nullable(),
  ...indianAddressShape,
  /** Exactly one per tenant (partial unique index); the head office cannot be deactivated. */
  isHeadOffice: z.boolean(),
  isActive: z.boolean(),
};

const branchRecordObject = z.object(branchFields);
type BranchRuleInput = z.output<typeof branchRecordObject>;

/** A branch GSTIN is registered in the branch's state. */
const branchRules = (value: BranchRuleInput, ctx: z.RefinementCtx): void => {
  checkGstinConsistency({ gstin: value.gstin, pan: null, stateCode: value.stateCode }, ctx);
};

/** The whole branch with its rules. The service parses `{ ...existing, ...patch }` with it. */
export const branchRecordSchema = branchRecordObject.superRefine(branchRules);
export type BranchRecord = z.output<typeof branchRecordSchema>;

export const branchResponseSchema = z.object({
  ...recordMetaShape,
  code: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  ...indianAddressResponseShape,
  isHeadOffice: z.boolean(),
  isActive: z.boolean(),
});
export type BranchResponse = z.infer<typeof branchResponseSchema>;

export const branchCreateSchema = z
  .strictObject({
    ...branchFields,
    gstin: branchFields.gstin.default(null),
    line2: branchFields.line2.default(null),
    isHeadOffice: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine(branchRules);
export type BranchCreate = z.infer<typeof branchCreateSchema>;
export type BranchCreateInput = z.input<typeof branchCreateSchema>;

export const branchUpdateSchema = updateSchema(branchFields);
export type BranchUpdate = z.infer<typeof branchUpdateSchema>;

export const branchListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['code', 'name', 'stateCode', 'createdAt']).optional(),
  active: activeFilterSchema,
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;
