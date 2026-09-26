import { z } from 'zod';
import { permissionSchema } from '../access/permissions.js';
import { membershipStatusSchema, userSummarySchema } from '../access/users.js';
import {
  emailSchema,
  gstinSchema,
  mobileSchema,
  refSchema,
  text,
  timestampSchema,
  uuidSchema,
} from '../common/primitives.js';

const utf8 = new TextEncoder();

/** bcrypt ignores everything after byte 72, so no password may be longer. */
export const PASSWORD_MAX_BYTES = 72;
const withinBcryptLimit = (p: string): boolean => utf8.encode(p).length <= PASSWORD_MAX_BYTES;

// Request bodies are strict: an unknown key is a 422, never silently dropped.

/**
 * New-password policy (security standard): at least 10 characters. At most 72 UTF-8 bytes,
 * because bcrypt ignores everything after byte 72. The common-password check runs in the API.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .refine(withinBcryptLimit, 'Use at most 72 bytes');

export const fullNameSchema = text(120);

/** `POST /auth/signup` (spec 01 §3.1). */
export const signupSchema = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  mobile: mobileSchema,
  password: passwordSchema,
  gstin: gstinSchema,
  acceptTerms: z.literal(true),
});
export type Signup = z.infer<typeof signupSchema>;

/**
 * `POST /auth/login`. The new-password policy is not applied (old passwords must still work),
 * but a password over 72 UTF-8 bytes is a 422: no stored password can be longer, and bcrypt would
 * otherwise accept any suffix after byte 72.
 */
export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).refine(withinBcryptLimit, 'Use at most 72 bytes'),
  tenantId: uuidSchema.optional(),
});
export type Login = z.infer<typeof loginSchema>;

export const selectTenantSchema = z.strictObject({
  selectionToken: z.string().min(1),
  tenantId: uuidSchema,
});
export type SelectTenant = z.infer<typeof selectTenantSchema>;

export const switchTenantSchema = z.strictObject({ tenantId: uuidSchema });
export type SwitchTenant = z.infer<typeof switchTenantSchema>;

/**
 * `POST /auth/accept-invitation`. An existing user sends only the token. A new user also sends
 * their name and a password, which must come together.
 */
export const acceptInvitationSchema = z
  .strictObject({
    token: z.string().min(1).max(256),
    fullName: fullNameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => (v.fullName === undefined) === (v.password === undefined), {
    message: 'Send both full name and password, or neither',
    path: ['password'],
  });
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;

/** `POST /auth/invitations/preview`: the token travels in the body, never in a URL path. */
export const invitationTokenSchema = z.strictObject({ token: z.string().min(1).max(256) });
export type InvitationToken = z.infer<typeof invitationTokenSchema>;

/**
 * What the invitation page shows before acceptance. `existingUser` tells the page whether to ask
 * for a name and password (new user) or only to confirm (existing user).
 */
export const invitationPreviewSchema = z.object({
  email: z.string(),
  companyName: z.string(),
  roleName: z.string(),
  invitedByName: z.string().nullable(),
  expiresAt: timestampSchema,
  existingUser: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/**
 * `POST /auth/accept-invitation` → 200. No session is started: the user signs in next, with the
 * password they just chose or their existing one.
 */
export const acceptInvitationResponseSchema = z.object({
  email: z.string(),
  tenant: z.object({ id: uuidSchema, name: z.string() }),
  userCreated: z.boolean(),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'closed'] as const;
export const TENANT_PLANS = ['starter', 'growth', 'pro'] as const;

export const tenantSummarySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  /** The company's trade name (legal name when there is none). */
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  plan: z.enum(TENANT_PLANS),
  trialEndsAt: timestampSchema.nullable(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const membershipSummarySchema = z.object({
  id: uuidSchema,
  role: refSchema,
  allBranches: z.boolean(),
  branchIds: z.array(uuidSchema),
  status: membershipStatusSchema,
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

/**
 * Returned by signup, login, select-tenant, switch-tenant and refresh. The refresh token travels
 * only in the httpOnly cookie, never in the body.
 */
export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  user: userSummarySchema,
  tenant: tenantSummarySchema,
  membership: membershipSummarySchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const tenantChoiceSchema = z.object({
  tenantId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  roleName: z.string(),
});
export type TenantChoice = z.infer<typeof tenantChoiceSchema>;

/** Login for a user with several memberships and no `tenantId`: pick one, then select-tenant. */
export const tenantSelectionResponseSchema = z.object({
  requiresTenantSelection: z.literal(true),
  /** Signed, valid for 5 minutes. */
  selectionToken: z.string(),
  tenants: z.array(tenantChoiceSchema).min(1),
});
export type TenantSelectionResponse = z.infer<typeof tenantSelectionResponseSchema>;

export const loginResponseSchema = z.union([tokenResponseSchema, tenantSelectionResponseSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `GET /auth/me`: the membership carries role and branch scope; permissions are effective. */
export const meResponseSchema = z.object({
  user: userSummarySchema,
  tenant: tenantSummarySchema,
  membership: membershipSummarySchema,
  permissions: z.array(permissionSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
