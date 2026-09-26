import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import { recordMetaShape, text } from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { isReadOnlyPermission, type Permission, permissionSchema } from './permissions.js';

const uniquePermissions = z
  .array(permissionSchema)
  .refine((list) => new Set(list).size === list.length, 'Permissions must be unique');

const roleFields = {
  name: text(50),
  description: text(200).nullable(),
  permissions: uniquePermissions,
  isBillable: z.boolean(),
};

interface BillingRuleInput {
  readonly isBillable: boolean;
  readonly permissions: readonly Permission[];
}

/**
 * BRD §12: free users are read-only. A non-billable role may hold only `:view` and `:export`
 * permissions, so a free seat can never be a working seat under another name.
 */
function checkFreeRoleReadOnly(value: BillingRuleInput, ctx: z.RefinementCtx): void {
  if (value.isBillable) return;
  const writes = value.permissions.filter((p) => !isReadOnlyPermission(p));
  if (writes.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['permissions'],
      message: `A free (non-billable) role can only view and export; remove ${writes.join(', ')}`,
    });
  }
}

/**
 * A role as the API edits it. The service parses `roleRecordSchema.parse({ ...existing, ...patch })`
 * before saving, so a patch cannot break the free-role rule once merged.
 */
export const roleRecordSchema = z.object(roleFields).superRefine(checkFreeRoleReadOnly);
export type RoleRecord = z.output<typeof roleRecordSchema>;

export const roleResponseSchema = z.object({
  ...recordMetaShape,
  name: z.string(),
  description: z.string().nullable(),
  /** Effective permissions. For Owner, the full catalogue (computed, not stored). */
  permissions: z.array(permissionSchema),
  isSystem: z.boolean(),
  /** The tenant's one Owner role: its permissions and billing flag can never be edited. */
  isOwner: z.boolean(),
  isBillable: z.boolean(),
});
export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const roleCreateSchema = z
  .strictObject({
    ...roleFields,
    description: roleFields.description.default(null),
    permissions: uniquePermissions.default([]),
    isBillable: z.boolean().default(true),
  })
  .superRefine(checkFreeRoleReadOnly);
export type RoleCreate = z.infer<typeof roleCreateSchema>;
export type RoleCreateInput = z.input<typeof roleCreateSchema>;

export const roleUpdateSchema = updateSchema(roleFields);
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

export const roleCloneSchema = z.strictObject({ name: roleFields.name });
export type RoleClone = z.infer<typeof roleCloneSchema>;

export const roleListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['name', 'createdAt']).optional(),
});
export type RoleListQuery = z.infer<typeof roleListQuerySchema>;
