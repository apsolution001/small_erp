import { z } from 'zod';
import { timestampSchema, uuidSchema } from '../common/primitives.js';

export const AUDIT_ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const AUDIT_PAGE_SIZE_DEFAULT = 50;
export const AUDIT_PAGE_SIZE_MAX = 200;

/** An opaque keyset cursor returned as `meta.nextCursor` (base64url). */
export const auditCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/, 'Invalid cursor');

/**
 * `GET /audit-logs` (spec 01 §3.4): newest first, keyset-paginated. `from` is inclusive and `to`
 * exclusive. `table` is a table name such as `memberships`; `rowId` is the audited row's key
 * (for `company_profile` the tenant id, for `membership_branches` the membership id).
 */
export const auditLogQuerySchema = z
  .strictObject({
    table: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/, 'Expected a table name')
      .optional(),
    rowId: uuidSchema.optional(),
    userId: uuidSchema.optional(),
    action: auditActionSchema.optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    cursor: auditCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(AUDIT_PAGE_SIZE_DEFAULT),
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to),
    { message: '`from` must be before `to`', path: ['to'] },
  );
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type AuditLogQueryInput = z.input<typeof auditLogQuerySchema>;

const rowDataSchema = z.record(z.string(), z.unknown());

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  tableName: z.string(),
  /** Null only for rows written before a table's audit key was configured. */
  rowId: uuidSchema.nullable(),
  action: auditActionSchema,
  oldData: rowDataSchema.nullable(),
  newData: rowDataSchema.nullable(),
  /** The acting user; `name` is null when the user is not (or no longer) visible to the tenant. */
  changedBy: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  changedAt: timestampSchema,
  requestId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogPageSchema = z.object({
  data: z.array(auditLogEntrySchema),
  meta: z.object({
    limit: z.int().min(1),
    /** Pass as `cursor` for the next (older) page; null on the last page. */
    nextCursor: auditCursorSchema.nullable(),
  }),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
