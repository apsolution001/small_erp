import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type ItemsRepository } from '../items/items.repository.js';
import { type CompanyRepository } from './company.repository.js';
import { CompanyService } from './company.service.js';
import { type CompanyProfileRow } from './company-profile.schema.js';

const at = new Date('2026-04-01T04:30:00.000Z');

function profile(overrides: Partial<CompanyProfileRow> = {}): CompanyProfileRow {
  return {
    tenantId: uuidv7(),
    legalName: 'Acme Traders LLP',
    tradeName: null,
    gstin: '27AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
    stateCode: '27',
    line1: '12 MG Road',
    line2: null,
    city: 'Pune',
    pincode: '411001',
    email: 'accounts@acme.in',
    phone: '+919876543210',
    logoObjectKey: null,
    booksBeginDate: '2026-04-01',
    valuationMethod: 'weighted_average',
    allowNegativeStock: false,
    roundOffSales: true,
    hsnMinDigits: 4,
    eInvoiceEnabled: false,
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

describe('CompanyService', () => {
  const repo = { find: vi.fn(), update: vi.fn() };
  const items = { extendFirstRatesTo: vi.fn() };
  const postings = { hasStockPostings: vi.fn() };
  const service = new CompanyService(
    repo as unknown as CompanyRepository,
    items as unknown as ItemsRepository,
    postings,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    postings.hasStockPostings.mockResolvedValue(false);
  });

  it('changes the valuation method and books date while nothing is posted', async () => {
    const row = profile();
    repo.find.mockResolvedValue(row);
    repo.update.mockResolvedValue({ ...row, valuationMethod: 'fifo', version: 2 });
    const updated = await service.update({ valuationMethod: 'fifo', version: 1 });
    expect(repo.find).toHaveBeenCalledWith({ forUpdate: true });
    expect(repo.update).toHaveBeenCalledWith({ valuationMethod: 'fifo' });
    expect(updated).toMatchObject({ valuationMethod: 'fifo', version: 2 });
  });

  it('locks the valuation method and books date once stock is posted (409)', async () => {
    repo.find.mockResolvedValue(profile());
    postings.hasStockPostings.mockResolvedValue(true);
    expect(await failure(service.update({ valuationMethod: 'fifo', version: 1 }))).toMatchObject({
      status: 409,
      code: 'VALUATION_METHOD_LOCKED',
    });
    expect(
      await failure(service.update({ booksBeginDate: '2025-04-01', version: 1 })),
    ).toMatchObject({ status: 409, code: 'BOOKS_BEGIN_DATE_LOCKED' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('does not ask about postings when neither locked field changes', async () => {
    const row = profile();
    repo.find.mockResolvedValue(row);
    repo.update.mockResolvedValue(row);
    await service.update({ valuationMethod: 'weighted_average', roundOffSales: false, version: 1 });
    expect(postings.hasStockPostings).not.toHaveBeenCalled();
  });

  it('extends item rates when the books start earlier, not later', async () => {
    const row = profile();
    repo.find.mockResolvedValue(row);
    repo.update.mockResolvedValue(row);
    await service.update({ booksBeginDate: '2025-04-01', version: 1 });
    expect(items.extendFirstRatesTo).toHaveBeenCalledWith('2025-04-01');
    items.extendFirstRatesTo.mockClear();
    await service.update({ booksBeginDate: '2026-07-01', version: 1 });
    expect(items.extendFirstRatesTo).not.toHaveBeenCalled();
  });

  it('validates the merged record: a state that does not match the GSTIN is a 422', async () => {
    repo.find.mockResolvedValue(profile());
    const error = await failure(service.update({ stateCode: '29', version: 1 }));
    expect((error as ValidationError).errors.map((e) => e.path)).toEqual(['gstin']);
  });

  it('refuses a stale version', async () => {
    repo.find.mockResolvedValue(profile({ version: 3 }));
    expect(await failure(service.update({ roundOffSales: false, version: 2 }))).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });
});
