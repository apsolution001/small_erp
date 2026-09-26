import { defaultRole, PERMISSIONS } from '@ekaro/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeAccessCache,
  fakeCls,
  fakeTenantContext,
  principal,
  TENANT_ID,
} from '../testing/fakes.js';
import { type RoleRow } from './roles.schema.js';
import { type RolesRepository } from './roles.repository.js';
import { RolesService } from './roles.service.js';

const AT = new Date('2026-09-26T06:00:00.000Z');

function roleRow(overrides: Partial<RoleRow> = {}): RoleRow {
  return {
    id: '01920000-0000-7000-8000-00000000c001',
    tenantId: TENANT_ID,
    name: 'Dispatch',
    description: null,
    permissions: ['masters.item:view'],
    isSystem: false,
    isOwner: false,
    isBillable: true,
    createdAt: AT,
    createdBy: null,
    updatedAt: AT,
    updatedBy: null,
    version: 3,
    ...overrides,
  };
}

const pgError = (code: string, constraint: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('db'), { code, severity: 'ERROR', constraint }),
  });

function setup(options: { row?: RoleRow; admin?: boolean } = {}) {
  const row = options.row ?? roleRow();
  const repo = {
    findById: vi.fn(() => Promise.resolve(row)),
    lockById: vi.fn(() => Promise.resolve(row)),
    insert: vi.fn((values: Partial<RoleRow>) =>
      Promise.resolve(roleRow({ ...values, version: 1 })),
    ),
    update: vi.fn((_id: string, _version: number, changes: Partial<RoleRow>) =>
      Promise.resolve(roleRow({ ...row, ...changes, version: row.version + 1 })),
    ),
    delete: vi.fn(() => Promise.resolve()),
    isInUse: vi.fn(() => Promise.resolve(false)),
  };
  const tx = fakeTenantContext();
  const { cache, accessCache } = fakeAccessCache();
  const who = options.admin
    ? principal({ isOwner: false, permissions: new Set(defaultRole('Admin').permissions) })
    : principal();
  const service = new RolesService(
    repo as unknown as RolesRepository,
    accessCache,
    tx.context,
    fakeCls(who),
  );
  return { service, repo, tx, cache };
}

describe('RolesService', () => {
  it('maps a row to the response with effective permissions (Owner: the catalogue)', async () => {
    const { service } = setup({ row: roleRow({ isOwner: true, isSystem: true, permissions: [] }) });
    const role = await service.get('x');
    expect(role).toMatchObject({ isOwner: true, permissions: [...PERMISSIONS], version: 3 });
    expect(role.createdAt).toBe('2026-09-26T06:00:00.000Z');
  });

  it('404s an unknown role', async () => {
    const { service, repo } = setup();
    repo.findById.mockResolvedValueOnce(undefined as never);
    await expect(service.get('x')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('maps a duplicate name to 409 ALREADY_EXISTS', async () => {
    const { service, repo } = setup();
    repo.insert.mockRejectedValueOnce(pgError('23505', 'roles_tenant_name_unique'));
    await expect(
      service.create({ name: 'Sales', description: null, permissions: [], isBillable: true }),
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_EXISTS' });
  });

  describe('update', () => {
    it('refuses a stale version before anything else (409)', async () => {
      const { service, repo } = setup();
      await expect(service.update('x', { name: 'New', version: 2 })).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('validates the merged record (a free role cannot write)', async () => {
      const { service } = setup({ row: roleRow({ isBillable: false }) });
      await expect(
        service.update('x', { permissions: ['masters.item:edit'], version: 3 }),
      ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    });

    it('saves, then drops the tenant access cache only after commit', async () => {
      const { service, repo, tx, cache } = setup();
      const saved = await service.update('x', { name: 'Dispatch 2', version: 3 });
      expect(saved).toMatchObject({ name: 'Dispatch 2', version: 4 });
      expect(repo.update).toHaveBeenCalledWith('x', 3, {
        name: 'Dispatch 2',
        description: null,
        permissions: ['masters.item:view'],
        isBillable: true,
      });
      expect(cache.invalidateTenant).not.toHaveBeenCalled();
      await tx.commit();
      expect(cache.invalidateTenant).toHaveBeenCalledWith(TENANT_ID);
    });

    it('keeps storing no permissions for the Owner role when it is renamed', async () => {
      const { service, repo } = setup({
        row: roleRow({ isOwner: true, isSystem: true, permissions: [] }),
      });
      await service.update('x', { name: 'Maalik', version: 3 });
      expect(repo.update).toHaveBeenCalledWith(
        'x',
        3,
        expect.objectContaining({ permissions: [] }),
      );
    });

    it('reports a lost race on the version as 409 too', async () => {
      const { service, repo, tx } = setup();
      repo.update.mockResolvedValueOnce(undefined as never);
      await expect(service.update('x', { name: 'N', version: 3 })).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
      });
      expect(tx.queued).toEqual([]);
    });
  });

  describe('delete', () => {
    it('refuses a role in use (409 ROLE_IN_USE)', async () => {
      const { service, repo } = setup();
      repo.isInUse.mockResolvedValueOnce(true);
      await expect(service.delete('x')).rejects.toMatchObject({ status: 409, code: 'ROLE_IN_USE' });
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('maps a concurrent assignment (FK or pending-invitation check) to ROLE_IN_USE', async () => {
      for (const error of [
        pgError('23503', 'memberships_role_fk'),
        pgError('23514', 'invitations_role_while_pending'),
      ]) {
        const { service, repo } = setup();
        repo.delete.mockRejectedValueOnce(error);
        await expect(service.delete('x')).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
      }
    });

    it('rethrows other database errors', async () => {
      const { service, repo } = setup();
      const boom = new Error('boom');
      repo.delete.mockRejectedValueOnce(boom);
      await expect(service.delete('x')).rejects.toBe(boom);
    });
  });

  it('clones with the effective permissions, as an ordinary role', async () => {
    const { service, repo } = setup({
      row: roleRow({ isOwner: true, isSystem: true, permissions: [], description: 'All' }),
    });
    await service.clone('x', { name: 'Co-owner' });
    expect(repo.insert).toHaveBeenCalledWith({
      name: 'Co-owner',
      description: 'All',
      permissions: [...PERMISSIONS],
      isBillable: true,
    });
  });

  it('an Admin cannot clone the Owner role (403 PERMISSION_NOT_HELD)', async () => {
    const { service } = setup({
      row: roleRow({ isOwner: true, isSystem: true, permissions: [] }),
      admin: true,
    });
    await expect(service.clone('x', { name: 'Mine' })).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_NOT_HELD',
    });
  });
});
