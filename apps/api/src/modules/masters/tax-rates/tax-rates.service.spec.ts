import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError } from '../../../common/errors/domain-error.js';
import { type TaxRatesRepository } from './tax-rates.repository.js';
import { type TaxRateRow } from './tax-rates.schema.js';
import { TaxRatesService } from './tax-rates.service.js';

const pgError = (code: string, constraint: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('driver'), { code, severity: 'ERROR', constraint }),
  });

function slab(overrides: Partial<TaxRateRow> = {}): TaxRateRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    name: 'GST 18%',
    gstRate: '18.0000',
    cessRate: '0.0000',
    isExempt: false,
    isNilRated: false,
    isNonGst: false,
    isActive: true,
    createdAt: new Date('2026-04-01T04:30:00.000Z'),
    createdBy: null,
    updatedAt: new Date('2026-04-01T04:30:00.000Z'),
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

describe('TaxRatesService', () => {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const service = new TaxRatesService(repo as unknown as TaxRatesRepository);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the rates exactly as stored (numeric(7,4) strings)', async () => {
    const row = slab({ gstRate: '0.2500', name: 'GST 0.25%' });
    repo.findById.mockResolvedValue(row);
    expect(await service.get(row.id)).toMatchObject({ gstRate: '0.2500', cessRate: '0.0000' });
  });

  it('reports a slab that already exists as 409 ALREADY_EXISTS', async () => {
    repo.insert.mockRejectedValue(pgError('23505', 'tax_rates_tenant_slab_unique'));
    const error = await failure(
      service.create({
        name: 'Eighteen',
        gstRate: '18',
        cessRate: '0',
        isExempt: false,
        isNilRated: false,
        isNonGst: false,
        isActive: true,
      }),
    );
    expect(error).toMatchObject({ status: 409, code: 'ALREADY_EXISTS' });
  });

  it('renames and deactivates with the current version, writing only those fields', async () => {
    const row = slab({ version: 2 });
    repo.findById.mockResolvedValue(row);
    repo.update.mockResolvedValue({ ...row, name: 'GST 18% (old)', isActive: false, version: 3 });
    const updated = await service.update(row.id, {
      name: 'GST 18% (old)',
      isActive: false,
      version: 2,
    });
    expect(repo.update).toHaveBeenCalledWith(row.id, { name: 'GST 18% (old)', isActive: false });
    expect(updated).toMatchObject({ gstRate: '18.0000', isActive: false, version: 3 });
  });

  it('refuses a stale version (409 VERSION_CONFLICT)', async () => {
    repo.findById.mockResolvedValue(slab({ version: 5 }));
    expect(await failure(service.update(uuidv7(), { name: 'X', version: 4 }))).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a slab an item uses (409 IN_USE), and 404s an unknown one', async () => {
    repo.delete.mockRejectedValueOnce(pgError('23503', 'item_tax_rates_tax_rate_fk'));
    expect(await failure(service.remove(uuidv7()))).toMatchObject({ status: 409, code: 'IN_USE' });
    repo.delete.mockResolvedValueOnce(false);
    expect(await failure(service.remove(uuidv7()))).toMatchObject({ status: 404 });
  });
});
