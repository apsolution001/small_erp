import { defaultRole } from '@ekaro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { type RoleRow } from '../roles/roles.schema.js';
import { type RolesRepository } from '../roles/roles.repository.js';
import {
  fakeAccessCache,
  fakeCls,
  fakeTenantContext,
  principal,
  TENANT_ID,
} from '../testing/fakes.js';
import { type MemberRow, type UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

const AT = new Date('2026-09-26T06:00:00.000Z');
const NOW = new Date('2026-09-27T09:00:00.000Z');
const HO = '01920000-0000-7000-8000-00000000d001';
const BRANCH_2 = '01920000-0000-7000-8000-00000000d002';
const SALES_ROLE = '01920000-0000-7000-8000-00000000e001';
const STORE_ROLE = '01920000-0000-7000-8000-00000000e002';
const OWNER_ROLE = '01920000-0000-7000-8000-00000000e003';

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: '01920000-0000-7000-8000-00000000f001',
    tenantId: TENANT_ID,
    version: 2,
    createdAt: AT,
    updatedAt: AT,
    userId: '01920000-0000-7000-8000-00000000f0a1',
    email: 'sita@example.com',
    fullName: 'Sita',
    mobile: null,
    roleId: SALES_ROLE,
    roleName: 'Sales',
    roleIsOwner: false,
    rolePermissions: [...defaultRole('Sales').permissions],
    allBranches: true,
    branchIds: [],
    status: 'active',
    joinedAt: AT,
    ...overrides,
  };
}

function setup(existing: MemberRow = member()) {
  const repo = {
    findById: vi.fn(() => Promise.resolve(existing)),
    update: vi.fn(() => Promise.resolve({ id: existing.id })),
    replaceBranches: vi.fn(() => Promise.resolve()),
    countOtherActiveOwners: vi.fn(() => Promise.resolve(1)),
    activeBranchIds: vi.fn((ids: readonly string[]) =>
      Promise.resolve(new Set(ids.filter((id) => id === HO || id === BRANCH_2))),
    ),
  };
  const roles = {
    findById: vi.fn((id: string) =>
      Promise.resolve(
        id === STORE_ROLE
          ? ({ id, isOwner: false, permissions: [...defaultRole('Store').permissions] } as RoleRow)
          : undefined,
      ),
    ),
  };
  const tx = fakeTenantContext();
  const { cache, accessCache } = fakeAccessCache();
  const service = new UsersService(
    repo as unknown as UsersRepository,
    roles as unknown as RolesRepository,
    accessCache,
    tx.context,
    fakeCls(principal()),
    { now: () => NOW },
  );
  return { service, repo, tx, cache };
}

describe('UsersService.update', () => {
  it('saves the merged record and drops the membership cache after commit', async () => {
    const { service, repo, tx, cache } = setup();
    await service.update(member().id, { roleId: STORE_ROLE, version: 2 });
    expect(repo.update).toHaveBeenCalledWith(member().id, 2, {
      roleId: STORE_ROLE,
      allBranches: true,
      status: 'active',
      joinedAt: AT,
    });
    expect(repo.replaceBranches).not.toHaveBeenCalled();
    expect(cache.invalidateMembership).not.toHaveBeenCalled();
    await tx.commit();
    expect(cache.invalidateMembership).toHaveBeenCalledWith(TENANT_ID, member().id);
  });

  it('replaces the branch scope only when it changes', async () => {
    const { service, repo } = setup(member({ allBranches: false, branchIds: [HO] }));
    await service.update(member().id, { branchIds: [HO, BRANCH_2], version: 2 });
    expect(repo.replaceBranches).toHaveBeenCalledWith(member().id, [HO, BRANCH_2]);
    expect(repo.activeBranchIds).toHaveBeenCalledWith([BRANCH_2]);
  });

  it('keeps an already assigned branch even if it became inactive; refuses a new inactive one', async () => {
    const stale = '01920000-0000-7000-8000-00000000d0ff';
    const { service } = setup(member({ allBranches: false, branchIds: [stale] }));
    await expect(
      service.update(member().id, { status: 'disabled', version: 2 }),
    ).resolves.toBeDefined();
    const other = setup(member());
    await expect(
      other.service.update(member().id, { allBranches: false, branchIds: [stale], version: 2 }),
    ).rejects.toMatchObject({ status: 422, errors: [{ path: 'branchIds' }] });
  });

  it('stamps joinedAt when an invited membership becomes active', async () => {
    const { service, repo } = setup(member({ status: 'invited', joinedAt: null }));
    await service.update(member().id, { status: 'active', version: 2 });
    expect(repo.update).toHaveBeenCalledWith(
      member().id,
      2,
      expect.objectContaining({ joinedAt: NOW }),
    );
  });

  it('counts the other Owners, under lock, only when an active Owner is changed', async () => {
    const owner = setup(
      member({ roleId: OWNER_ROLE, roleName: 'Owner', roleIsOwner: true, rolePermissions: [] }),
    );
    owner.repo.countOtherActiveOwners.mockResolvedValueOnce(0);
    await expect(
      owner.service.update(member().id, { status: 'disabled', version: 2 }),
    ).rejects.toMatchObject({ status: 422, code: 'LAST_OWNER' });
    expect(owner.repo.countOtherActiveOwners).toHaveBeenCalledWith(OWNER_ROLE, member().id);
    expect(owner.repo.update).not.toHaveBeenCalled();

    const plain = setup();
    await plain.service.update(member().id, { status: 'disabled', version: 2 });
    expect(plain.repo.countOtherActiveOwners).not.toHaveBeenCalled();
  });

  it('rejects an unknown role, a stale version and a merged scope that breaks the rule', async () => {
    const { service, repo } = setup();
    await expect(
      service.update(member().id, { roleId: '01920000-0000-7000-8000-00000000eeee', version: 2 }),
    ).rejects.toMatchObject({ status: 422, errors: [{ path: 'roleId' }] });
    await expect(
      service.update(member().id, { status: 'disabled', version: 1 }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    await expect(
      service.update(member().id, { allBranches: false, version: 2 }),
    ).rejects.toMatchObject({ status: 422, errors: [{ path: 'branchIds' }] });
    repo.update.mockResolvedValueOnce(undefined as never);
    await expect(
      service.update(member().id, { status: 'disabled', version: 2 }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });

  it('404s an unknown membership', async () => {
    const { service, repo } = setup();
    repo.findById.mockResolvedValueOnce(undefined as never);
    await expect(service.get('x')).rejects.toMatchObject({ status: 404 });
  });
});
