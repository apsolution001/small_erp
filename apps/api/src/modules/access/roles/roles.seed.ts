import { DEFAULT_ROLES } from '@ekaro/contracts';
import { type NewRoleRow } from './roles.schema.js';

/**
 * The nine BRD §8.1 roles as system rows. The Owner role stores no permissions: its effective
 * permissions are the whole catalogue, computed (`effectivePermissions`).
 */
export function buildSystemRoles(): NewRoleRow[] {
  return DEFAULT_ROLES.map((role) => ({
    name: role.name,
    description: role.description,
    permissions: role.allPermissions ? [] : [...role.permissions],
    isSystem: true,
    isOwner: role.allPermissions,
    isBillable: role.billable,
  }));
}
