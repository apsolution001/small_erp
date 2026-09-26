import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type BranchesService } from '../branches/branches.service.js';
import { type GodownsRepository } from './godowns.repository.js';
import { type GodownRow } from './godowns.schema.js';
import { GodownsService } from './godowns.service.js';

const at = new Date('2026-04-01T04:30:00.000Z');
const BRANCH = uuidv7();

function godown(overrides: Partial<GodownRow> = {}): GodownRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    branchId: BRANCH,
    code: 'MAIN',
    name: 'Main',
    address: null,
    allowNegativeStock: false,
    isActive: true,
    createdAt: at,
    createdBy: null,
    updatedAt: at,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
}

const paths = (error: DomainError) => (error as ValidationError).errors.map((e) => e.path);

describe('GodownsService', () => {
  const repo = { list: vi.fn(), findById: vi.fn(), insert: vi.fn(), update: vi.fn() };
  const branches = { lockBranches: vi.fn(), findActive: vi.fn() };
  const service = new GodownsService(
    repo as unknown as GodownsRepository,
    branches as unknown as BranchesService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    branches.findActive.mockResolvedValue({ id: BRANCH });
    repo.insert.mockImplementation((values: object) => ({ ...godown(), ...values }));
    repo.update.mockImplementation((id: string, values: object) => ({
      ...godown({ id }),
      ...values,
    }));
  });

  it('creates an active godown only in an active branch, under the branch lock', async () => {
    const input = {
      branchId: BRANCH,
      code: 'G2',
      name: 'Store 2',
      address: null,
      allowNegativeStock: false,
      isActive: true,
    };
    await service.create(input);
    expect(branches.lockBranches).toHaveBeenCalled();
    branches.findActive.mockResolvedValue(undefined);
    expect(paths(await failure(service.create(input)))).toEqual(['branchId']);
  });

  it('checks the branch when a godown moves or is re-activated, not on a rename', async () => {
    const inactive = godown({ isActive: false });
    repo.findById.mockResolvedValue(inactive);
    branches.findActive.mockResolvedValue(undefined);
    expect(
      paths(await failure(service.update(inactive.id, { isActive: true, version: 1 }))),
    ).toEqual(['branchId']);
    repo.findById.mockResolvedValue(godown());
    expect(
      paths(await failure(service.update(uuidv7(), { branchId: uuidv7(), version: 1 }))),
    ).toEqual(['branchId']);
    await service.update(uuidv7(), { name: 'Main store', version: 1 });
    expect(repo.update).toHaveBeenCalledWith(expect.any(String), { name: 'Main store' });
  });

  it('refuses a stale version and deactivates on remove', async () => {
    repo.findById.mockResolvedValue(godown({ version: 2 }));
    expect(await failure(service.update(uuidv7(), { name: 'X', version: 1 }))).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    const row = godown();
    repo.findById.mockResolvedValue(row);
    await service.remove(row.id);
    expect(repo.update).toHaveBeenCalledWith(row.id, { isActive: false });
  });
});
