import { DEFAULT_ROLES, effectivePermissions, PERMISSIONS } from '@ekaro/contracts';
import { describe, expect, it } from 'vitest';
import { buildSystemRoles } from './roles.seed.js';

describe('buildSystemRoles', () => {
  const roles = buildSystemRoles();

  it('seeds the nine BRD §8.1 roles as system roles, with their billing flag', () => {
    expect(roles.map((r) => [r.name, r.isBillable])).toEqual([
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
    expect(roles.every((r) => r.isSystem === true)).toBe(true);
  });

  it('marks only the Owner, which stores no permissions but is granted the whole catalogue', () => {
    const owners = roles.filter((r) => r.isOwner === true);
    expect(owners.map((r) => [r.name, r.permissions])).toEqual([['Owner', []]]);
    expect(effectivePermissions({ isOwner: true, permissions: [] })).toEqual([...PERMISSIONS]);
  });

  it('stores each other role exactly as the default role table', () => {
    for (const role of DEFAULT_ROLES.filter((r) => !r.allPermissions)) {
      const row = roles.find((r) => r.name === role.name);
      expect(row?.permissions, role.name).toEqual([...role.permissions]);
      expect(row?.description).toBe(role.description);
    }
  });
});
