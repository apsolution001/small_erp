import { type ItemCreate } from '@ekaro/contracts';
import { uuidv7 } from '@ekaro/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainError, type ValidationError } from '../../../common/errors/domain-error.js';
import { type CompanyService } from '../company/company.service.js';
import { type ItemCategoriesService } from '../item-categories/item-categories.service.js';
import { type UnitsService } from '../units/units.service.js';
import { type ItemUnitRow } from './item-units.schema.js';
import { type ItemsRepository } from './items.repository.js';
import { type ItemRow } from './items.schema.js';
import { hsnDigitsError, ItemsService } from './items.service.js';

const KGS = uuidv7();
const BAG = uuidv7();
const TENANT = uuidv7();
const at = new Date('2026-04-01T04:30:00.000Z');

function itemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: uuidv7(),
    tenantId: TENANT,
    code: 'TMT-8',
    name: 'TMT bar 8 mm',
    description: null,
    itemType: 'goods',
    itemKind: 'trading',
    categoryId: null,
    hsnSac: '7214',
    baseUnitId: KGS,
    purchaseUnitId: null,
    salesUnitId: null,
    reorderLevel: null,
    reorderQty: null,
    minOrderQty: null,
    trackBatches: true,
    trackExpiry: true,
    standardPurchaseRate: null,
    standardSalesRate: '62.500000',
    isActive: true,
    createdAt: at,
    createdBy: null,
    updatedAt: at,
    updatedBy: null,
    version: 1,
    ...overrides,
  };
}

const bagConversion = (itemId: string): ItemUnitRow => ({
  id: uuidv7(),
  tenantId: TENANT,
  itemId,
  unitId: BAG,
  factorToBase: '50.000000',
  createdAt: at,
  createdBy: null,
  updatedAt: at,
  updatedBy: null,
  version: 1,
});

const createInput = (overrides: Partial<ItemCreate> = {}): ItemCreate => ({
  code: 'TMT-8',
  name: 'TMT bar 8 mm',
  description: null,
  itemType: 'goods',
  itemKind: 'trading',
  categoryId: null,
  hsnSac: '7214',
  baseUnitId: KGS,
  purchaseUnitId: null,
  salesUnitId: BAG,
  reorderLevel: null,
  reorderQty: null,
  minOrderQty: null,
  trackBatches: false,
  trackExpiry: false,
  standardPurchaseRate: null,
  standardSalesRate: null,
  isActive: true,
  units: [{ unitId: BAG, factorToBase: '50' }],
  taxRateId: uuidv7(),
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

const paths = (error: DomainError) => (error as ValidationError).errors.map((e) => e.path);

describe('hsnDigitsError', () => {
  it('needs at least the company minimum of digits', () => {
    expect(hsnDigitsError('7214', 4)).toBeUndefined();
    expect(hsnDigitsError('72142090', 6)).toBeUndefined();
    expect(hsnDigitsError('7214', 6)).toEqual({
      path: 'hsnSac',
      message: 'HSN/SAC must have at least 6 digits (company setting)',
      code: 'custom',
    });
  });
});

describe('ItemsService', () => {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    unitsOf: vi.fn(),
    replaceUnits: vi.fn(),
    taxRatesOf: vi.fn(),
    taxRateOn: vi.fn(),
    insertTaxRate: vi.fn(),
  };
  const company = { settings: vi.fn() };
  const units = { findActiveIds: vi.fn() };
  const categories = { findActiveIds: vi.fn() };
  const service = new ItemsService(
    repo as unknown as ItemsRepository,
    company as unknown as CompanyService,
    units as unknown as UnitsService,
    categories as unknown as ItemCategoriesService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    company.settings.mockResolvedValue({ hsnMinDigits: 4, booksBeginDate: '2026-04-01' });
    units.findActiveIds.mockResolvedValue(new Set([KGS, BAG]));
    categories.findActiveIds.mockResolvedValue(new Set());
    repo.unitsOf.mockResolvedValue([]);
    repo.taxRatesOf.mockResolvedValue([]);
  });

  describe('create', () => {
    it('stores the item, its conversions and its first rate from the books-begin date', async () => {
      const row = itemRow();
      repo.insert.mockResolvedValue(row);
      repo.findById.mockResolvedValue(row);
      const input = createInput();
      await service.create(input);
      const { taxRateId, units: conversions, ...fields } = input;
      expect(repo.insert).toHaveBeenCalledWith(fields);
      expect(repo.replaceUnits).toHaveBeenCalledWith(row.id, conversions);
      expect(repo.insertTaxRate).toHaveBeenCalledWith({
        itemId: row.id,
        taxRateId,
        effectiveFrom: '2026-04-01',
      });
    });

    it('refuses an HSN shorter than the company minimum (422 on hsnSac)', async () => {
      company.settings.mockResolvedValue({ hsnMinDigits: 6, booksBeginDate: '2026-04-01' });
      expect(paths(await failure(service.create(createInput())))).toEqual(['hsnSac']);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('refuses inactive or unknown units and categories, on the field that names them', async () => {
      units.findActiveIds.mockResolvedValue(new Set([KGS]));
      const error = await failure(service.create(createInput({ categoryId: uuidv7() })));
      expect(paths(error)).toEqual(['salesUnitId', 'units.0.unitId', 'categoryId']);
    });
  });

  describe('update', () => {
    it('validates the merged record: dropping batches while expiry is tracked is a 422', async () => {
      const row = itemRow();
      repo.findById.mockResolvedValue(row);
      const error = await failure(service.update(row.id, { trackBatches: false, version: 1 }));
      expect(paths(error)).toEqual(['trackExpiry']);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does not re-check an unchanged HSN or units already in use', async () => {
      const row = itemRow({ salesUnitId: BAG });
      repo.findById.mockResolvedValue(row);
      repo.unitsOf.mockResolvedValue([bagConversion(row.id)]);
      company.settings.mockResolvedValue({ hsnMinDigits: 6, booksBeginDate: '2026-04-01' });
      units.findActiveIds.mockResolvedValue(new Set());
      await service.update(row.id, { name: 'TMT bar 8 mm Fe 500', version: 1 });
      expect(repo.update).toHaveBeenCalledWith(row.id, { name: 'TMT bar 8 mm Fe 500' });
      expect(repo.replaceUnits).not.toHaveBeenCalled();
      expect(company.settings).not.toHaveBeenCalled();
    });

    it('replaces the conversions only when they are sent', async () => {
      const row = itemRow();
      repo.findById.mockResolvedValue(row);
      await service.update(row.id, {
        units: [{ unitId: BAG, factorToBase: '25' }],
        version: 1,
      });
      expect(repo.update).toHaveBeenCalledWith(row.id, {});
      expect(repo.replaceUnits).toHaveBeenCalledWith(row.id, [{ unitId: BAG, factorToBase: '25' }]);
    });

    it('refuses a stale version', async () => {
      repo.findById.mockResolvedValue(itemRow({ version: 2 }));
      expect(await failure(service.update(uuidv7(), { name: 'X', version: 1 }))).toMatchObject({
        status: 409,
        code: 'VERSION_CONFLICT',
      });
    });
  });

  it('deactivates on remove, once', async () => {
    const row = itemRow();
    repo.findById.mockResolvedValueOnce(row);
    await service.remove(row.id);
    expect(repo.update).toHaveBeenCalledWith(row.id, { isActive: false });
    repo.findById.mockResolvedValueOnce({ ...row, isActive: false });
    await service.remove(row.id);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  describe('tax rates', () => {
    it('refuses a rate that starts before the books', async () => {
      repo.findById.mockResolvedValue(itemRow());
      const error = await failure(
        service.addTaxRate(uuidv7(), { taxRateId: uuidv7(), effectiveFrom: '2026-03-31' }),
      );
      expect(paths(error)).toEqual(['effectiveFrom']);
    });

    it('returns the row in force on a date, or none before the first', async () => {
      const itemId = uuidv7();
      repo.findById.mockResolvedValue(itemRow({ id: itemId }));
      const row = { id: uuidv7(), itemId, taxRateId: uuidv7(), effectiveFrom: '2026-04-01' };
      repo.taxRateOn.mockResolvedValueOnce(row);
      expect(await service.taxRates(itemId, { on: '2026-05-01' })).toEqual([
        { id: row.id, taxRateId: row.taxRateId, effectiveFrom: '2026-04-01' },
      ]);
      repo.taxRateOn.mockResolvedValueOnce(undefined);
      expect(await service.taxRates(itemId, { on: '2026-03-01' })).toEqual([]);
    });
  });
});
