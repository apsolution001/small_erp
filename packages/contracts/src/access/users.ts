import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import {
  emailSchema,
  mobileSchema,
  recordMetaShape,
  refSchema,
  timestampSchema,
  uuidSchema,
  versionSchema,
} from '../common/primitives.js';

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'disabled'] as const;
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

const branchIdsSchema = z
  .array(uuidSchema)
  .refine((ids) => new Set(ids).size === ids.length, 'Branches must be unique');

interface BranchScope {
  allBranches?: boolean | undefined;
  branchIds?: readonly string[] | undefined;
}

/**
 * Branch scope rule: all branches means no explicit list; otherwise at least one branch.
 * Checked only when both fields are present (a PATCH may send just one; the service checks the
 * merged record).
 */
function checkBranchScope(value: BranchScope, ctx: z.RefinementCtx): void {
  if (value.allBranches === undefined || value.branchIds === undefined) return;
  if (value.allBranches && value.branchIds.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['branchIds'],
      message: 'Leave branches empty when the user has all branches',
    });
  }
  if (!value.allBranches && value.branchIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['branchIds'], message: 'Choose at least one branch' });
  }
}

/** A tenant user = a membership joined to its user (`GET /users`). `id` is the membership id. */
export const membershipResponseSchema = z.object({
  ...recordMetaShape,
  userId: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  mobile: z.string().nullable(),
  role: refSchema,
  allBranches: z.boolean(),
  branchIds: z.array(uuidSchema),
  status: membershipStatusSchema,
  joinedAt: timestampSchema.nullable(),
});
export type MembershipResponse = z.infer<typeof membershipResponseSchema>;

export const userListQuerySchema = paginationQuerySchema.extend({
  status: membershipStatusSchema.optional(),
  roleId: uuidSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** `POST /users`: sends an invitation. */
export const inviteUserSchema = z
  .object({
    email: emailSchema,
    roleId: uuidSchema,
    allBranches: z.boolean().default(true),
    branchIds: branchIdsSchema.default([]),
  })
  .superRefine(checkBranchScope);
export type InviteUser = z.infer<typeof inviteUserSchema>;
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const invitationResponseSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  role: refSchema,
  allBranches: z.boolean(),
  branchIds: z.array(uuidSchema),
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

/** `PATCH /users/:membershipId`. A membership cannot be moved back to `invited`. */
export const membershipUpdateSchema = z
  .object({
    roleId: uuidSchema.optional(),
    allBranches: z.boolean().optional(),
    branchIds: branchIdsSchema.optional(),
    status: z.enum(['active', 'disabled']).optional(),
    version: versionSchema,
  })
  .superRefine(checkBranchScope);
export type MembershipUpdate = z.infer<typeof membershipUpdateSchema>;

export const userSummarySchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  mobile: mobileSchema.nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;
