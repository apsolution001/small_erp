import { z } from 'zod';

/**
 * Stable machine-readable error codes carried in `problem.code`. The web maps codes to messages,
 * so never rename one; add new codes instead.
 */
export const ERROR_CODES = [
  // generic
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'ALREADY_EXISTS',
  'IN_USE',
  'BUSINESS_RULE_VIOLATION',
  'IDEMPOTENCY_KEY_REQUIRED',
  'METHOD_NOT_ALLOWED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  // authentication and sessions
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'REFRESH_REUSED',
  'TENANT_SELECTION_REQUIRED',
  'TENANT_SUSPENDED',
  'EMAIL_TAKEN',
  'GSTIN_INACTIVE',
  // access control
  'FORBIDDEN',
  'ROLE_IN_USE',
  'SYSTEM_ROLE_IMMUTABLE',
  'SELF_ROLE_CHANGE',
  'LAST_OWNER',
  'OWNER_ASSIGNMENT_FORBIDDEN',
  'INVITATION_INVALID',
  'INVITATION_EXPIRED',
  // masters
  'HEAD_OFFICE_REQUIRED',
  'BRANCH_HAS_ACTIVE_GODOWNS',
  'VALUATION_METHOD_LOCKED',
  'SERIES_NUMBER_DECREASE',
  // documents and accounting
  'INVALID_TRANSITION',
  'PERIOD_LOCKED',
  'CREDIT_LIMIT_EXCEEDED',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
/** Enum-style access: `ErrorCode.NOT_FOUND`. */
export const ErrorCode = errorCodeSchema.enum;

/** One invalid field. `path` uses dots, as react-hook-form does: `addresses.0.pincode`. */
export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/** RFC 9457 problem details (`application/problem+json`) with Ekaro's extension members. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: errorCodeSchema,
  errors: z.array(fieldErrorSchema).optional(),
  requestId: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;
