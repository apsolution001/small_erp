import { type DocumentSeriesCreate } from '@ekaro/contracts';
import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type BranchesService } from '../branches/branches.service.js';
import { type CompanyService } from '../company/company.service.js';
import { type DocumentSeriesRepository } from './document-series.repository.js';
import { type DocumentSeriesRow } from './document-series.schema.js';
import { DocumentSeriesService } from './document-series.service.js';

const at = new Date('2026-04-01T04:30:00.000Z');
const HO = uuidv7();
const GSTIN = '27AAPFU0939F1ZV';

function stored(overrides: Partial<DocumentSeriesRow> = {}): DocumentSeriesRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    branchId: HO,
    docType: 'sales_invoice',
    fy: '2026-27',
    prefix: 'SI/26-27/',
    suffix: '',
    padding: 4,
    nextNumber: 1n,
    lastIssuedNumber: null,
    isDefault: true,
    createdAt: at,
    createdBy: null,
    updatedAt: at,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

const input = (overrides: Partial<DocumentSeriesCreate> = {}): DocumentSeriesCreate => ({
  branchId: HO,
  docType: 'sales_invoice',
  fy: '2026-27',
  prefix: 'EXP/',
  suffix: '',
  padding: 4,
  nextNumber: '1',
  isDefault: false,
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

describe('DocumentSeriesService', () => {
  const repo = {
    lockSeries: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    findInFamily: vi.fn(),
    clearDefault: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const branches = { findActive: vi.fn(), get: vi.fn() };
  const company = { settings: vi.fn() };
  const service = new DocumentSeriesService(
    repo as unknown as DocumentSeriesRepository,
    branches as unknown as BranchesService,
    company as unknown as CompanyService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    branches.findActive.mockResolvedValue({ id: HO, gstin: GSTIN });
    branches.get.mockResolvedValue({ id: HO, gstin: GSTIN });
    company.settings.mockResolvedValue({ gstin: GSTIN });
    repo.findInFamily.mockResolvedValue([{ ...stored(), branchGstin: GSTIN }]);
    repo.insert.mockImplementation((values: object) => ({ ...stored(), ...values }));
    repo.update.mockImplementation((id: string, values: object) => ({
      ...stored({ id }),
      ...values,
    }));
  });

  describe('create', () => {
    it('stores the next number as a bigint and moves the default when asked', async () => {
      const created = await service.create(input({ nextNumber: '101', isDefault: true }));
      expect(repo.lockSeries).toHaveBeenCalled();
      expect(repo.clearDefault).toHaveBeenCalledWith(HO, 'sales_invoice', '2026-27');
      expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ nextNumber: 101n }));
      expect(created.nextNumber).toBe('101');
    });

    it('refuses a series that could repeat numbers under the same GSTIN (409)', async () => {
      const error = await failure(service.create(input({ prefix: 'SI/26-27/0', padding: 3 })));
      expect(error).toMatchObject({ status: 409, code: 'SERIES_NUMBERS_OVERLAP' });
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('needs an active branch (422 on branchId)', async () => {
      branches.findActive.mockResolvedValue(undefined);
      const error = await failure(service.create(input()));
      expect((error as ValidationError).errors.map((e) => e.path)).toEqual(['branchId']);
    });
  });

  describe('update', () => {
    it('lets the numbering change while nothing is issued', async () => {
      const row = stored({ id: uuidv7() });
      repo.findById.mockResolvedValue(row);
      repo.findInFamily.mockResolvedValue([{ ...row, branchGstin: GSTIN }]);
      await service.update(row.id, { prefix: 'INV/26-27/', nextNumber: '50', version: 1 });
      expect(repo.update).toHaveBeenCalledWith(row.id, { prefix: 'INV/26-27/', nextNumber: 50n });
    });

    it('fixes the numbering once a number is issued (409), but not the default flag', async () => {
      const issued = stored({ nextNumber: 43n, lastIssuedNumber: 42n, isDefault: false });
      repo.findById.mockResolvedValue(issued);
      for (const patch of [
        { prefix: 'X/' },
        { padding: 5 },
        { suffix: '/A' },
        { nextNumber: '99' },
      ]) {
        expect(await failure(service.update(issued.id, { ...patch, version: 1 }))).toMatchObject({
          status: 409,
          code: 'SERIES_NUMBERING_LOCKED',
        });
      }
      await service.update(issued.id, { isDefault: true, prefix: 'SI/26-27/', version: 1 });
      expect(repo.clearDefault).toHaveBeenCalled();
    });

    it('never lets the next number go back (422 SERIES_NUMBER_DECREASE)', async () => {
      repo.findById.mockResolvedValue(stored({ nextNumber: 10n }));
      expect(
        await failure(service.update(uuidv7(), { nextNumber: '9', version: 1 })),
      ).toMatchObject({ status: 422, code: 'SERIES_NUMBER_DECREASE' });
    });

    it('checks the 16-character rule on the merged record', async () => {
      repo.findById.mockResolvedValue(stored());
      const error = await failure(service.update(uuidv7(), { padding: 8, version: 1 }));
      expect((error as ValidationError).errors.map((e) => e.path)).toEqual(['padding']);
    });
  });
});
