import { type BranchCreate } from '@ekaro/contracts';
import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type CompanyService } from '../company/company.service.js';
import { type BranchesRepository } from './branches.repository.js';
import { type BranchRow } from './branches.schema.js';
import { BranchesService } from './branches.service.js';

const at = new Date('2026-04-01T04:30:00.000Z');

function branch(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    code: 'HO',
    name: 'Head Office',
    gstin: '27AAPFU0939F1ZV',
    stateCode: '27',
    line1: '12 MG Road',
    line2: null,
    city: 'Pune',
    pincode: '411001',
    isHeadOffice: true,
    isActive: true,
    createdAt: at,
    createdBy: null,
    updatedAt: at,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

const newBranch = (overrides: Partial<BranchCreate> = {}): BranchCreate => ({
  code: 'BLR',
  name: 'Bengaluru',
  gstin: null,
  line1: '1 Residency Road',
  line2: null,
  city: 'Bengaluru',
  pincode: '560025',
  stateCode: '29',
  isHeadOffice: false,
  isActive: true,
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
}

describe('BranchesService', () => {
  const repo = {
    lockBranches: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    countActiveGodowns: vi.fn(),
    clearHeadOffice: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const company = { settings: vi.fn() };
  const service = new BranchesService(
    repo as unknown as BranchesRepository,
    company as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    company.settings.mockResolvedValue({ pan: 'AAPFU0939F', gstin: '27AAPFU0939F1ZV' });
    repo.countActiveGodowns.mockResolvedValue(0);
    repo.insert.mockImplementation((values: object) => ({ ...branch(), ...values }));
    repo.update.mockImplementation((id: string, values: object) => ({
      ...branch({ id }),
      ...values,
    }));
  });

  describe('create', () => {
    it('accepts a GSTIN of the company PAN registered in the branch state', async () => {
      await service.create(newBranch({ gstin: '29AAPFU0939F1ZR' }));
      expect(repo.lockBranches).toHaveBeenCalled();
      expect(repo.insert).toHaveBeenCalled();
    });

    it('refuses a GSTIN of another PAN (422 on gstin)', async () => {
      const error = await failure(service.create(newBranch({ gstin: '29AAGCB7383J1Z4' })));
      expect((error as ValidationError).errors.map((e) => e.path)).toEqual(['gstin']);
    });

    it('moves the head-office flag when a new branch is the head office', async () => {
      await service.create(newBranch({ isHeadOffice: true }));
      expect(repo.clearHeadOffice).toHaveBeenCalled();
    });
  });

  describe('head office and godown rules', () => {
    it('cannot unset or deactivate the head office (422 HEAD_OFFICE_REQUIRED)', async () => {
      repo.findById.mockResolvedValue(branch());
      for (const patch of [{ isHeadOffice: false }, { isActive: false }]) {
        expect(await failure(service.update(uuidv7(), { ...patch, version: 1 }))).toMatchObject({
          status: 422,
          code: 'HEAD_OFFICE_REQUIRED',
        });
      }
      expect(await failure(service.remove(uuidv7()))).toMatchObject({
        code: 'HEAD_OFFICE_REQUIRED',
      });
    });

    it('makes another branch the head office, moving the flag', async () => {
      const blr = branch({ isHeadOffice: false, gstin: null, stateCode: '29', pincode: '560025' });
      repo.findById.mockResolvedValue(blr);
      await service.update(blr.id, { isHeadOffice: true, version: 1 });
      expect(repo.clearHeadOffice).toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(blr.id, { isHeadOffice: true });
    });

    it('refuses to deactivate a branch with active godowns (409)', async () => {
      const blr = branch({ isHeadOffice: false });
      repo.findById.mockResolvedValue(blr);
      repo.countActiveGodowns.mockResolvedValue(2);
      expect(await failure(service.remove(blr.id))).toMatchObject({
        status: 409,
        code: 'BRANCH_HAS_ACTIVE_GODOWNS',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('deactivates an ordinary branch on remove, once', async () => {
      const blr = branch({ isHeadOffice: false });
      repo.findById.mockResolvedValueOnce(blr);
      await service.remove(blr.id);
      expect(repo.update).toHaveBeenCalledWith(blr.id, { isActive: false });
      repo.findById.mockResolvedValueOnce({ ...blr, isActive: false });
      await service.remove(blr.id);
      expect(repo.update).toHaveBeenCalledTimes(1);
    });
  });

  it('validates the merged record: moving the state away from the GSTIN is a 422', async () => {
    repo.findById.mockResolvedValue(branch());
    const error = await failure(service.update(uuidv7(), { stateCode: '29', version: 1 }));
    expect((error as ValidationError).errors.map((e) => e.path)).toEqual(['gstin']);
  });
});
