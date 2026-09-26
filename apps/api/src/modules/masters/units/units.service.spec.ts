import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type UnitsRepository } from './units.repository.js';
import { type UnitRow } from './units.schema.js';
import { UnitsService } from './units.service.js';

const pgError = (code: string, constraint: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('driver'), { code, severity: 'ERROR', constraint }),
  });

function unitRow(overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    id: uuidv7(),
    tenantId: uuidv7(),
    code: 'KGS',
    name: 'Kilograms',
    uqc: 'KGS',
    decimalPlaces: 3,
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

describe('UnitsService', () => {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    findActiveIds: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const service = new UnitsService(repo as unknown as UnitsRepository);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists a page of contract-shaped units without internal columns', async () => {
    const row = unitRow();
    repo.list.mockResolvedValue({ rows: [row], total: 41 });
    const page = await service.list({ page: 2, pageSize: 1 });
    expect(page).toEqual({
      data: [
        {
          id: row.id,
          version: 1,
          createdAt: '2026-04-01T04:30:00.000Z',
          updatedAt: '2026-04-01T04:30:00.000Z',
          code: 'KGS',
          name: 'Kilograms',
          uqc: 'KGS',
          decimalPlaces: 3,
          isActive: true,
        },
      ],
      meta: { page: 2, pageSize: 1, total: 41 },
    });
    expect(page.data[0]).not.toHaveProperty('tenantId');
  });

  it('is a 404 for an unknown unit', async () => {
    repo.findById.mockResolvedValue(undefined);
    expect(await failure(service.get(uuidv7()))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('reports a duplicate code as 409 ALREADY_EXISTS naming the code', async () => {
    repo.insert.mockRejectedValue(pgError('23505', 'units_tenant_code_unique'));
    const error = await failure(
      service.create({ code: 'BAG', name: 'Bag', uqc: 'BAG', decimalPlaces: 0, isActive: true }),
    );
    expect(error).toMatchObject({
      status: 409,
      code: 'ALREADY_EXISTS',
      message: 'A unit with code BAG already exists.',
    });
  });

  describe('update', () => {
    it('locks the row, writes only the fields sent, and returns the new version', async () => {
      const existing = unitRow({ version: 3 });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue({ ...existing, name: 'Kilogram', version: 4 });
      const updated = await service.update(existing.id, { name: 'Kilogram', version: 3 });
      expect(repo.findById).toHaveBeenCalledWith(existing.id, { forUpdate: true });
      expect(repo.update).toHaveBeenCalledWith(existing.id, { name: 'Kilogram' });
      expect(updated).toMatchObject({ name: 'Kilogram', version: 4 });
    });

    it('refuses a stale version with 409 VERSION_CONFLICT and writes nothing', async () => {
      repo.findById.mockResolvedValue(unitRow({ version: 4 }));
      const error = await failure(service.update(uuidv7(), { name: 'X', version: 3 }));
      expect(error).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('validates the merged record (a stored value no longer valid is reported)', async () => {
      repo.findById.mockResolvedValue(unitRow({ decimalPlaces: 9 }));
      const error = await failure(service.update(uuidv7(), { name: 'Kilogram', version: 1 }));
      expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
      expect((error as ValidationError).errors.map((e) => e.path)).toEqual(['decimalPlaces']);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('reports a code taken by another unit as 409 ALREADY_EXISTS', async () => {
      repo.findById.mockResolvedValue(unitRow());
      repo.update.mockRejectedValue(pgError('23505', 'units_tenant_code_unique'));
      const error = await failure(service.update(uuidv7(), { code: 'NOS', version: 1 }));
      expect(error).toMatchObject({ status: 409, message: 'A unit with code NOS already exists.' });
    });

    it('is a 404 for an unknown unit', async () => {
      repo.findById.mockResolvedValue(undefined);
      expect(await failure(service.update(uuidv7(), { name: 'X', version: 1 }))).toMatchObject({
        status: 404,
      });
    });
  });

  describe('remove', () => {
    it('deletes an unused unit', async () => {
      repo.delete.mockResolvedValue(true);
      await expect(service.remove(uuidv7())).resolves.toBeUndefined();
    });

    it('is a 409 IN_USE when an item references the unit', async () => {
      repo.delete.mockRejectedValue(pgError('23503', 'items_base_unit_fk'));
      expect(await failure(service.remove(uuidv7()))).toMatchObject({
        status: 409,
        code: 'IN_USE',
      });
    });

    it('is a 404 when there is no such unit', async () => {
      repo.delete.mockResolvedValue(false);
      expect(await failure(service.remove(uuidv7()))).toMatchObject({ status: 404 });
    });
  });
});
