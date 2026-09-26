import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import {
  emailSchema,
  recordMetaShape,
  refSchema,
  timestampSchema,
  uuidSchema,
} from '../common/primitives.js';
import { updateSchema } from '../common/update.js';

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'disabled'] as const;
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

const branchIdsSchema = z
  .array(uuidSchema)
  .refine((ids) => new Set(ids).size === ids.length, 'Branches must be unique');

/**
 * A tenant user as the API edits it: the membership's role, branch scope and status. The
 * service parses `userRecordSchema.parse({ ...existing, ...patch })` before saving.
 */
const userRecordObject = z.object({
  roleId: uuidSchema,
  allBranches: z.boolean(),
  branchIds: branchIdsSchema,
  status: membershipStatusSchema,
});
type BranchScopeRuleInput = Pick<z.output<typeof userRecordObject>, 'allBranches' | 'branchIds'>;

/** Branch scope rule: all branches means no explicit list; otherwise at least one branch. */
function checkBranchScope(value: BranchScopeRuleInput, ctx: z.RefinementCtx): void {
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

export const userRecordSchema = userRecordObject.superRefine(checkBranchScope);
export type UserRecord = z.output<typeof userRecordSchema>;

/**
 * A tenant user = a membership joined with its user (`GET /users`). `id` is the membership id.
 */
export const userResponseSchema = z.object({
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
export type UserResponse = z.infer<typeof userResponseSchema>;

export const userListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['fullName', 'email', 'createdAt']).optional(),
  status: membershipStatusSchema.optional(),
  roleId: uuidSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** `POST /users`: sends an invitation. */
export const userInviteSchema = z
  .strictObject({
    email: emailSchema,
    roleId: uuidSchema,
    allBranches: z.boolean().default(true),
    branchIds: branchIdsSchema.default([]),
  })
  .superRefine(checkBranchScope);
export type UserInvite = z.infer<typeof userInviteSchema>;
export type UserInviteInput = z.input<typeof userInviteSchema>;

/**
 * Where an invitation stands. `expired` is derived: pending past `expiresAt`. An expired or
 * pending invitation still holds its role until it is revoked.
 */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const invitationStatusSchema = z.enum(INVITATION_STATUSES);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationResponseSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  /** Null only once the invitation is closed and its role was deleted afterwards. */
  role: refSchema.nullable(),
  allBranches: z.boolean(),
  branchIds: z.array(uuidSchema),
  status: invitationStatusSchema,
  /** The user who sent it; null when that user cannot be shown. */
  invitedBy: refSchema.nullable(),
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

/** `GET /invitations`. */
export const invitationListQuerySchema = paginationQuerySchema.extend({
  status: invitationStatusSchema.optional(),
  sort: sortSchema(['email', 'createdAt', 'expiresAt']).optional(),
});
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>;

/** `PATCH /users/:membershipId`. A membership cannot be moved back to `invited`. */
export const userUpdateSchema = updateSchema({
  roleId: uuidSchema,
  allBranches: z.boolean(),
  branchIds: branchIdsSchema,
  status: z.enum(['active', 'disabled']),
});
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const userSummarySchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  mobile: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;
