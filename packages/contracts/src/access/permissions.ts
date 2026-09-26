import { z } from 'zod';

/**
 * Permission catalogue, `<module>.<resource>:<action>` (spec 01 §2, Sprint 1 slice).
 * `masters.item_tax_rate` is a deliberate addition to spec 01 (GST rate changes, spec 02).
 * Later sprints append to it; never rename an entry, because roles store these strings.
 */
export const PERMISSIONS = [
  'access.user:view',
  'access.user:create',
  'access.user:edit',
  'access.user:delete',
  'access.role:view',
  'access.role:create',
  'access.role:edit',
  'access.role:delete',
  'audit.log:view',
  'masters.company:view',
  'masters.company:edit',
  'masters.branch:view',
  'masters.branch:create',
  'masters.branch:edit',
  'masters.branch:delete',
  'masters.godown:view',
  'masters.godown:create',
  'masters.godown:edit',
  'masters.godown:delete',
  'masters.unit:view',
  'masters.unit:create',
  'masters.unit:edit',
  'masters.unit:delete',
  'masters.tax_rate:view',
  'masters.tax_rate:create',
  'masters.tax_rate:edit',
  'masters.tax_rate:delete',
  'masters.item_category:view',
  'masters.item_category:create',
  'masters.item_category:edit',
  'masters.item_category:delete',
  'masters.item:view',
  'masters.item:create',
  'masters.item:edit',
  'masters.item:delete',
  'masters.item:export',
  // Effective-dated GST rates of an item: the only way a rate changes (slabs are immutable).
  'masters.item_tax_rate:view',
  'masters.item_tax_rate:create',
  'masters.party:view',
  'masters.party:create',
  'masters.party:edit',
  'masters.party:delete',
  'masters.party:export',
  'masters.series:view',
  'masters.series:create',
  'masters.series:edit',
  'platform.billing:view',
  'platform.billing:edit',
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export interface DefaultRole {
  readonly name: string;
  readonly description: string;
  /** Counts toward per-user billing (BRD §12). CA and Viewer are free. */
  readonly billable: boolean;
  /**
   * True only for Owner: its permissions are computed as the whole catalogue, including
   * permissions added later, and are never stored or edited.
   */
  readonly allPermissions: boolean;
  readonly permissions: readonly Permission[];
}

export const OWNER_ROLE_NAME = 'Owner';

const all = (predicate: (p: Permission) => boolean): Permission[] => PERMISSIONS.filter(predicate);
const MASTER_VIEWS = all((p) => p.startsWith('masters.') && p.endsWith(':view'));

const role = (
  name: string,
  description: string,
  billable: boolean,
  permissions: readonly Permission[],
): DefaultRole => ({ name, description, billable, allPermissions: false, permissions });

/** The nine roles seeded into every tenant (spec 01 §2, BRD §8.1). */
export const DEFAULT_ROLES: readonly DefaultRole[] = Object.freeze([
  {
    name: OWNER_ROLE_NAME,
    description: 'Everything, including billing and user management',
    billable: true,
    allPermissions: true,
    permissions: PERMISSIONS,
  },
  role(
    'Admin',
    'Everything except billing',
    true,
    all((p) => !p.startsWith('platform.billing:')),
  ),
  role('Accountant', 'Accounts, GST and masters; views all masters', true, [
    ...MASTER_VIEWS,
    'masters.company:edit',
    'masters.tax_rate:create',
    'masters.tax_rate:edit',
    'masters.item_tax_rate:create',
    'masters.party:edit',
    'masters.series:edit',
    'audit.log:view',
  ]),
  role('Purchase', 'Purchasing and vendor masters', true, [
    'masters.item:view',
    'masters.item:create',
    'masters.item:edit',
    'masters.party:view',
    'masters.party:create',
    'masters.party:edit',
    'masters.unit:view',
    'masters.item_category:view',
  ]),
  role('Sales', 'Sales and customer masters', true, [
    'masters.item:view',
    'masters.party:view',
    'masters.party:create',
    'masters.party:edit',
  ]),
  role('Store', 'Stores and godowns', true, [
    'masters.item:view',
    'masters.unit:view',
    'masters.godown:view',
  ]),
  role('Production', 'Production and item masters', true, [
    'masters.item:view',
    'masters.item:create',
    'masters.item:edit',
    'masters.unit:view',
  ]),
  role('CA', 'External chartered accountant: read-only, exports and audit', false, [
    ...MASTER_VIEWS,
    'masters.item:export',
    'masters.party:export',
    'audit.log:view',
  ]),
  role('Viewer', 'Read-only', false, MASTER_VIEWS),
]);

export function defaultRole(name: string): DefaultRole {
  const found = DEFAULT_ROLES.find((r) => r.name === name);
  if (!found) throw new Error(`Unknown default role "${name}"`);
  return found;
}

const CATALOGUE: ReadonlySet<string> = new Set(PERMISSIONS);

/**
 * A role's effective permissions, in catalogue order. The owner always holds the whole catalogue
 * (computed, so permissions added later are included). Stored strings that are no longer in the
 * catalogue are ignored.
 */
export function effectivePermissions(role: {
  readonly isOwner: boolean;
  readonly permissions: readonly string[];
}): Permission[] {
  if (role.isOwner) return [...PERMISSIONS];
  const stored = new Set(role.permissions.filter((p) => CATALOGUE.has(p)));
  return PERMISSIONS.filter((p) => stored.has(p));
}

/** True when `granted` (a role's effective permissions) includes `required`. */
export function hasPermission(
  granted: ReadonlySet<Permission> | readonly Permission[],
  required: Permission,
): boolean {
  return 'has' in granted ? granted.has(required) : granted.includes(required);
}
