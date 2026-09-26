import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { gstinSchema, recordMetaShape, text, versionSchema } from '../common/primitives.js';
import { activeFilterSchema, checkGstinConsistency, indianAddressShape } from './shared.js';

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

/** Every field optional: the rules run on creates and on partial updates alike. */
const branchPatchSchema = z.object(branchFields).partial();
type BranchRuleInput = z.output<typeof branchPatchSchema>;

const branchRules = (value: BranchRuleInput, ctx: z.RefinementCtx): void => {
  checkGstinConsistency(value, value.stateCode, ctx);
};

export const branchResponseSchema = z.object({ ...recordMetaShape, ...branchFields });
export type BranchResponse = z.infer<typeof branchResponseSchema>;

export const branchCreateSchema = z
  .object({
    ...branchFields,
    gstin: branchFields.gstin.default(null),
    line2: branchFields.line2.default(null),
    isHeadOffice: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine(branchRules);
export type BranchCreate = z.infer<typeof branchCreateSchema>;
export type BranchCreateInput = z.input<typeof branchCreateSchema>;

export const branchUpdateSchema = branchPatchSchema
  .extend({ version: versionSchema })
  .superRefine(branchRules);
export type BranchUpdate = z.infer<typeof branchUpdateSchema>;

export const branchListQuerySchema = paginationQuerySchema.extend({ active: activeFilterSchema });
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;
