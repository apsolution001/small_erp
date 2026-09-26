import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLES,
  OWNER_ROLE_NAME,
  PERMISSIONS,
  defaultRole,
  effectivePermissions,
  hasPermission,
  permissionSchema,
  type Permission,
} from './permissions.js';

const expand = (resource: string, actions: string): string[] =>
  actions.split('|').map((a) => `${resource}:${a}`);

// Spec 01 §2, transcribed line by line.
const SPEC_CATALOGUE = [
  ...expand('access.user', 'view|create|edit|delete'),
  ...expand('access.role', 'view|create|edit|delete'),
  ...expand('audit.log', 'view'),
  ...expand('masters.company', 'view|edit'),
  ...expand('masters.branch', 'view|create|edit|delete'),
  ...expand('masters.godown', 'view|create|edit|delete'),
  ...expand('masters.unit', 'view|create|edit|delete'),
  ...expand('masters.tax_rate', 'view|create|edit|delete'),
  ...expand('masters.item_category', 'view|create|edit|delete'),
  ...expand('masters.item', 'view|create|edit|delete|export'),
  ...expand('masters.party', 'view|create|edit|delete|export'),
  ...expand('masters.series', 'view|create|edit'),
  ...expand('platform.billing', 'view|edit'),
];

const MASTER_VIEWS = [
  'masters.company:view',
  'masters.branch:view',
  'masters.godown:view',
  'masters.unit:view',
  'masters.tax_rate:view',
  'masters.item_category:view',
  'masters.item:view',
  'masters.party:view',
  'masters.series:view',
];

const permissionsOf = (name: string): string[] => [...defaultRole(name).permissions].sort();
const sorted = (list: readonly string[]): string[] => [...list].sort();

describe('PERMISSIONS catalogue', () => {
  it('matches spec 01 §2 exactly', () => {
    expect(sorted(PERMISSIONS)).toEqual(sorted(SPEC_CATALOGUE));
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it('uses the <module>.<resource>:<action> format', () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z]+\.[a-z_]+:[a-z]+$/);
  });

  it('validates permission strings', () => {
    expect(permissionSchema.safeParse('masters.item:view').success).toBe(true);
    expect(permissionSchema.safeParse('masters.item:approve').success).toBe(false);
  });
});

describe('DEFAULT_ROLES (spec 01 §2, BRD §8.1)', () => {
  it('seeds the nine roles in order with their billing flag', () => {
    expect(DEFAULT_ROLES.map((r) => [r.name, r.billable])).toEqual([
      ['Owner', true],
      ['Admin', true],
      ['Accountant', true],
      ['Purchase', true],
      ['Sales', true],
      ['Store', true],
      ['Production', true],
      ['CA', false],
      ['Viewer', false],
    ]);
  });

  it('Owner has every permission and is flagged as computed', () => {
    expect(OWNER_ROLE_NAME).toBe('Owner');
    expect(permissionsOf('Owner')).toEqual(sorted(PERMISSIONS));
    expect(defaultRole('Owner').allPermissions).toBe(true);
    expect(DEFAULT_ROLES.filter((r) => r.allPermissions).map((r) => r.name)).toEqual(['Owner']);
  });

  it('Admin has everything except platform.billing', () => {
    expect(permissionsOf('Admin')).toEqual(
      sorted(PERMISSIONS.filter((p) => !p.startsWith('platform.billing:'))),
    );
  });

  it('Accountant views all masters; edits company, tax rates, parties, series; views audit', () => {
    expect(permissionsOf('Accountant')).toEqual(
      sorted([
        ...MASTER_VIEWS,
        'masters.company:edit',
        'masters.tax_rate:edit',
        'masters.party:edit',
        'masters.series:edit',
        'audit.log:view',
      ]),
    );
  });

  it('Purchase manages items and parties; views units and categories', () => {
    expect(permissionsOf('Purchase')).toEqual(
      sorted([
        ...expand('masters.item', 'view|create|edit'),
        ...expand('masters.party', 'view|create|edit'),
        'masters.unit:view',
        'masters.item_category:view',
      ]),
    );
  });

  it('Sales views items and manages parties', () => {
    expect(permissionsOf('Sales')).toEqual(
      sorted(['masters.item:view', ...expand('masters.party', 'view|create|edit')]),
    );
  });

  it('Store views items, units and godowns', () => {
    expect(permissionsOf('Store')).toEqual(
      sorted(['masters.item:view', 'masters.unit:view', 'masters.godown:view']),
    );
  });

  it('Production manages items and views units', () => {
    expect(permissionsOf('Production')).toEqual(
      sorted([...expand('masters.item', 'view|create|edit'), 'masters.unit:view']),
    );
  });

  it('CA views all masters, exports, and views audit', () => {
    expect(permissionsOf('CA')).toEqual(
      sorted([...MASTER_VIEWS, 'masters.item:export', 'masters.party:export', 'audit.log:view']),
    );
  });

  it('Viewer views all masters only', () => {
    expect(permissionsOf('Viewer')).toEqual(sorted(MASTER_VIEWS));
  });

  it('only grants catalogue permissions', () => {
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) expect(PERMISSIONS, `${role.name}: ${p}`).toContain(p);
    }
  });

  it('defaultRole throws for an unknown name', () => {
    expect(() => defaultRole('Janitor')).toThrow('Unknown default role "Janitor"');
  });
});

describe('hasPermission', () => {
  it('checks arrays and sets', () => {
    const granted: Permission[] = ['masters.item:view'];
    expect(hasPermission(granted, 'masters.item:view')).toBe(true);
    expect(hasPermission(granted, 'masters.item:edit')).toBe(false);
    expect(hasPermission(new Set(granted), 'masters.item:view')).toBe(true);
    expect(hasPermission(new Set<Permission>(), 'masters.item:view')).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('gives the owner the whole catalogue, whatever is stored', () => {
    expect(effectivePermissions({ isOwner: true, permissions: [] })).toEqual([...PERMISSIONS]);
  });

  it('keeps stored catalogue permissions in catalogue order and drops unknown strings', () => {
    expect(
      effectivePermissions({
        isOwner: false,
        permissions: ['masters.party:view', 'retired.thing:view', 'masters.item:view'],
      }),
    ).toEqual(['masters.item:view', 'masters.party:view']);
  });

  it('matches every default role', () => {
    for (const role of DEFAULT_ROLES) {
      const stored = role.allPermissions ? [] : role.permissions;
      const effective = effectivePermissions({ isOwner: role.allPermissions, permissions: stored });
      expect(sorted(effective), role.name).toEqual(sorted(role.permissions));
    }
  });
});
