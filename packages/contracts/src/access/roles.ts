import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination.js';
import { recordMetaShape, text, versionSchema } from '../common/primitives.js';
import { permissionSchema } from './permissions.js';

const uniquePermissions = z
  .array(permissionSchema)
  .refine((list) => new Set(list).size === list.length, 'Permissions must be unique');

const roleFields = {
  name: text(50),
  description: text(200).nullable(),
  permissions: uniquePermissions,
  isBillable: z.boolean(),
};

export const roleResponseSchema = z.object({
  ...recordMetaShape,
  name: z.string(),
  description: z.string().nullable(),
  /** Effective permissions. For Owner, the full catalogue (computed, not stored). */
  permissions: z.array(permissionSchema),
  isSystem: z.boolean(),
  isBillable: z.boolean(),
});
export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const roleCreateSchema = z.object({
  ...roleFields,
  description: roleFields.description.default(null),
  permissions: uniquePermissions.default([]),
  isBillable: z.boolean().default(true),
});
export type RoleCreate = z.infer<typeof roleCreateSchema>;
export type RoleCreateInput = z.input<typeof roleCreateSchema>;

export const roleUpdateSchema = z.object(roleFields).partial().extend({ version: versionSchema });
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

export const roleCloneSchema = z.object({ name: roleFields.name });
export type RoleClone = z.infer<typeof roleCloneSchema>;

export const roleListQuerySchema = paginationQuerySchema;
export type RoleListQuery = z.infer<typeof roleListQuerySchema>;
