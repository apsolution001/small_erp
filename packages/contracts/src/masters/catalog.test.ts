import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import {
  itemCategoryCreateSchema,
  itemCategoryListQuerySchema,
  itemCategoryResponseSchema,
  itemCategoryTreeNodeSchema,
  itemCategoryUpdateSchema,
} from './item-category.js';
import {
  itemCreateSchema,
  itemListQuerySchema,
  itemRecordSchema,
  itemResponseSchema,
  itemTaxRateCreateSchema,
  itemUpdateSchema,
} from './item.js';
import {
  taxRateCreateSchema,
  taxRateListQuerySchema,
  taxRateRecordSchema,
  taxRateResponseSchema,
  taxRateUpdateSchema,
} from './tax-rate.js';
import {
  unitCreateSchema,
  unitListQuerySchema,
  unitResponseSchema,
  unitUpdateSchema,
  uqcSchema,
} from './unit.js';

const meta = {
  id: uuidv7(),
  version: 2,
  createdAt: '2026-04-01T04:30:00.000Z',
  updatedAt: '2026-09-26T10:15:00.123Z',
};

describe('unit schemas', () => {
  it('upper-cases the code and maps to a GST UQC', () => {
    expect(unitCreateSchema.parse({ code: 'bag', name: 'Bag of 50 kg', uqc: 'BAG' })).toEqual({
      code: 'BAG',
      name: 'Bag of 50 kg',
      uqc: 'BAG',
      decimalPlaces: 0,
      isActive: true,
    });
  });

  it('knows the UQC NA for services', () => {
    expect(uqcSchema.parse('NA')).toBe('NA');
  });

  it('rejects unknown UQCs, long codes and more than 6 decimal places', () => {
    expect(pathsOf(unitCreateSchema.safeParse({ code: 'BAG', name: 'Bag', uqc: 'SACK' }))).toEqual([
      'uqc',
    ]);
    expect(
      pathsOf(unitCreateSchema.safeParse({ code: 'ABCDEFGHIJK', name: 'X', uqc: 'OTH' })),
    ).toEqual(['code']);
    expect(
      pathsOf(
        unitCreateSchema.safeParse({ code: 'KG', name: 'Kilo', uqc: 'KGS', decimalPlaces: 7 }),
      ),
    ).toEqual(['decimalPlaces']);
  });

  it('updates without create defaults, needs a change, and is strict', () => {
    expect(unitUpdateSchema.parse({ name: 'Kilogram', version: 2 })).toEqual({
      name: 'Kilogram',
      version: 2,
    });
    expect(pathsOf(unitUpdateSchema.safeParse({ version: 2 }))).toEqual(['']);
    expect(
      unrecognizedKeysOf(unitCreateSchema.safeParse({ code: 'KG', name: 'K', uqc: 'KGS', id: 1 })),
    ).toEqual(['id']);
  });

  it('sorts on allowed columns only', () => {
    expect(unitListQuerySchema.parse({ sort: 'code:desc' }).sort).toBe('code:desc');
    expect(pathsOf(unitListQuerySchema.safeParse({ sort: 'uqc:asc' }))).toEqual(['sort']);
  });

  it('parses a DB-shaped unit row', () => {
    const row = {
      ...meta,
      code: 'KGS',
      name: 'Kilograms',
      uqc: 'KGS',
      decimalPlaces: 3,
      isActive: true,
    };
    expect(unitResponseSchema.parse(row)).toEqual(row);
  });
});

describe('tax rate schemas', () => {
  const existing = {
    ...meta,
    name: 'Exempt',
    gstRate: '0.0000',
    cessRate: '0.0000',
    isExempt: true,
    isNilRated: false,
    isNonGst: false,
    isActive: true,
  };

  it('defaults cess and flags', () => {
    expect(taxRateCreateSchema.parse({ name: 'GST 18%', gstRate: '18' })).toEqual({
      name: 'GST 18%',
      gstRate: '18',
      cessRate: '0',
      isExempt: false,
      isNilRated: false,
      isNonGst: false,
      isActive: true,
    });
  });

  it('accepts fractional slabs and caps the GST rate at 100', () => {
    expect(taxRateCreateSchema.safeParse({ name: 'GST 0.25%', gstRate: '0.25' }).success).toBe(
      true,
    );
    expect(pathsOf(taxRateCreateSchema.safeParse({ name: 'X', gstRate: '100.0001' }))).toEqual([
      'gstRate',
    ]);
  });

  it('an exempt, nil-rated or non-GST slab has a zero rate and only one such flag', () => {
    expect(
      taxRateCreateSchema.safeParse({ name: 'Exempt', gstRate: '0', isExempt: true }).success,
    ).toBe(true);
    expect(
      pathsOf(taxRateCreateSchema.safeParse({ name: 'Bad', gstRate: '5', isExempt: true })),
    ).toEqual(['gstRate']);
    expect(
      pathsOf(
        taxRateCreateSchema.safeParse({ name: 'Bad', gstRate: '0', cessRate: '1', isNonGst: true }),
      ),
    ).toEqual(['cessRate']);
    expect(
      pathsOf(
        taxRateCreateSchema.safeParse({
          name: 'Bad',
          gstRate: '0',
          isExempt: true,
          isNilRated: true,
        }),
      ),
    ).toEqual(['isNilRated']);
  });

  it('update changes only the name and the active flag: rates are immutable', () => {
    expect(
      taxRateUpdateSchema.parse({ name: 'GST 12% (old)', isActive: false, version: 2 }),
    ).toEqual({ name: 'GST 12% (old)', isActive: false, version: 2 });
    expect(
      unrecognizedKeysOf(
        taxRateUpdateSchema.safeParse({ gstRate: '5', cessRate: '1', isExempt: false, version: 2 }),
      ),
    ).toEqual(['gstRate', 'cessRate', 'isExempt']);
    expect(pathsOf(taxRateUpdateSchema.safeParse({ version: 2 }))).toEqual(['']);
  });

  it('the record schema rejects a merged slab that breaks the rules', () => {
    // A patch can no longer touch rates, but the merged record is still checked as a whole.
    const patch = { name: 'Exempt goods', version: 2 };
    expect(taxRateUpdateSchema.safeParse(patch).success).toBe(true);
    expect(taxRateRecordSchema.safeParse({ ...existing, ...patch }).success).toBe(true);
    expect(pathsOf(taxRateRecordSchema.safeParse({ ...existing, gstRate: '5' }))).toEqual([
      'gstRate',
    ]);
  });

  it('sorts on allowed columns only', () => {
    expect(taxRateListQuerySchema.parse({ sort: 'gstRate:asc' }).sort).toBe('gstRate:asc');
    expect(pathsOf(taxRateListQuerySchema.safeParse({ sort: 'isExempt:asc' }))).toEqual(['sort']);
  });

  it('parses a DB-shaped slab (numeric(7,4) strings)', () => {
    const row = { ...existing, name: 'GST 40%', gstRate: '40.0000', isExempt: false };
    expect(taxRateResponseSchema.parse(row)).toEqual(row);
  });
});

describe('item category schemas', () => {
  it('creates root and child categories', () => {
    expect(itemCategoryCreateSchema.parse({ name: 'Steel' })).toEqual({
      name: 'Steel',
      parentId: null,
      isActive: true,
    });
    expect(itemCategoryListQuerySchema.parse({ tree: 'true' }).tree).toBe(true);
  });

  it('updates without create defaults and is strict', () => {
    expect(itemCategoryUpdateSchema.parse({ name: 'Metals', version: 1 })).toEqual({
      name: 'Metals',
      version: 1,
    });
    expect(pathsOf(itemCategoryUpdateSchema.safeParse({ version: 1 }))).toEqual(['']);
    expect(unrecognizedKeysOf(itemCategoryCreateSchema.safeParse({ name: 'X', depth: 1 }))).toEqual(
      ['depth'],
    );
    expect(pathsOf(itemCategoryListQuerySchema.safeParse({ sort: 'parentId:asc' }))).toEqual([
      'sort',
    ]);
  });

  it('parses a nested tree and a DB-shaped row', () => {
    const leaf = { id: uuidv7(), name: 'TMT bars', parentId: null, isActive: true, children: [] };
    const tree = { ...leaf, name: 'Steel', children: [leaf] };
    expect(itemCategoryTreeNodeSchema.parse(tree)).toEqual(tree);
    const row = { ...meta, parentId: uuidv7(), name: 'TMT bars', isActive: false };
    expect(itemCategoryResponseSchema.parse(row)).toEqual(row);
  });
});

describe('item schemas', () => {
  const kgs = uuidv7();
  const bag = uuidv7();
  const goods = {
    code: 'TMT-8',
    name: 'TMT bar 8 mm',
    itemType: 'goods',
    itemKind: 'trading',
    hsnSac: '7214',
    baseUnitId: kgs,
    taxRateId: uuidv7(),
  };
  const { taxRateId: _initialRate, ...goodsFields } = goods;
  const stored = {
    ...meta,
    ...goodsFields,
    itemType: 'goods' as const,
    itemKind: 'trading' as const,
    description: null,
    categoryId: null,
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
    units: [{ unitId: bag, factorToBase: '50.000000' }],
    taxRates: [{ id: uuidv7(), taxRateId: goods.taxRateId, effectiveFrom: '2026-04-01' }],
  };

  it('applies defaults and keeps decimal strings exactly', () => {
    const parsed = itemCreateSchema.parse({
      ...goods,
      units: [{ unitId: bag, factorToBase: '50.000000' }],
      standardSalesRate: '62.500000',
    });
    expect(parsed).toEqual({
      ...goods,
      description: null,
      categoryId: null,
      purchaseUnitId: null,
      salesUnitId: null,
      reorderLevel: null,
      reorderQty: null,
      minOrderQty: null,
      trackBatches: false,
      trackExpiry: false,
      standardPurchaseRate: null,
      standardSalesRate: '62.500000',
      isActive: true,
      units: [{ unitId: bag, factorToBase: '50.000000' }],
    });
  });

  it('track_expiry requires track_batches', () => {
    expect(pathsOf(itemCreateSchema.safeParse({ ...goods, trackExpiry: true }))).toEqual([
      'trackExpiry',
    ]);
    expect(
      itemCreateSchema.safeParse({ ...goods, trackBatches: true, trackExpiry: true }).success,
    ).toBe(true);
  });

  it('rejects a patch that is valid alone but breaks track_expiry once merged', () => {
    const patch = { trackBatches: false, version: 2 };
    expect(itemUpdateSchema.safeParse(patch).success).toBe(true);
    expect(itemRecordSchema.safeParse(stored).success).toBe(true);
    expect(pathsOf(itemRecordSchema.safeParse({ ...stored, ...patch }))).toEqual(['trackExpiry']);
  });

  it('HSN for goods is 4, 6 or 8 digits; SAC for services is 6 digits starting 99', () => {
    for (const hsnSac of ['7214', '721420', '72142090']) {
      expect(itemCreateSchema.safeParse({ ...goods, hsnSac }).success, hsnSac).toBe(true);
    }
    for (const hsnSac of ['721', '72142', '7214209', 'ABCD']) {
      expect(pathsOf(itemCreateSchema.safeParse({ ...goods, hsnSac })), hsnSac).toEqual(['hsnSac']);
    }
    const service = { ...goods, itemType: 'service', itemKind: 'service' };
    expect(itemCreateSchema.safeParse({ ...service, hsnSac: '998314' }).success).toBe(true);
    expect(pathsOf(itemCreateSchema.safeParse({ ...service, hsnSac: '7214' }))).toEqual(['hsnSac']);
  });

  it('item kind "service" goes with item type "service" and no batch tracking', () => {
    expect(pathsOf(itemCreateSchema.safeParse({ ...goods, itemKind: 'service' }))).toEqual([
      'itemKind',
    ]);
    expect(
      pathsOf(
        itemCreateSchema.safeParse({
          ...goods,
          itemType: 'service',
          itemKind: 'service',
          hsnSac: '998314',
          trackBatches: true,
        }),
      ),
    ).toEqual(['trackBatches']);
  });

  it('checks UoM conversions: positive factors, unique units, not the base unit', () => {
    expect(
      pathsOf(
        itemCreateSchema.safeParse({ ...goods, units: [{ unitId: bag, factorToBase: '0' }] }),
      ),
    ).toEqual(['units.0.factorToBase']);
    expect(
      pathsOf(
        itemCreateSchema.safeParse({
          ...goods,
          units: [
            { unitId: bag, factorToBase: '50' },
            { unitId: bag, factorToBase: '25' },
          ],
        }),
      ),
    ).toEqual(['units.1.unitId']);
    expect(
      pathsOf(
        itemCreateSchema.safeParse({ ...goods, units: [{ unitId: kgs, factorToBase: '1' }] }),
      ),
    ).toEqual(['units.0.unitId']);
    expect(
      unrecognizedKeysOf(
        itemCreateSchema.safeParse({ ...goods, units: [{ unitId: bag, factorToBase: '5', x: 1 }] }),
      ),
    ).toEqual(['x']);
  });

  it('a patch that drops a unit still used as the sales unit is rejected once merged', () => {
    const withSalesBag = { ...stored, salesUnitId: bag };
    const patch = { units: [], version: 2 };
    expect(itemUpdateSchema.safeParse(patch).success).toBe(true);
    expect(pathsOf(itemRecordSchema.safeParse({ ...withSalesBag, ...patch }))).toEqual([
      'salesUnitId',
    ]);
  });

  it('reorder quantities cannot be negative', () => {
    expect(pathsOf(itemCreateSchema.safeParse({ ...goods, reorderLevel: '-1' }))).toEqual([
      'reorderLevel',
    ]);
    expect(itemCreateSchema.parse({ ...goods, reorderLevel: '0' }).reorderLevel).toBe('0');
  });

  it('purchase and sales units must be the base unit or a converted unit', () => {
    const units = [{ unitId: bag, factorToBase: '50' }];
    expect(
      itemCreateSchema.safeParse({ ...goods, units, purchaseUnitId: bag, salesUnitId: kgs })
        .success,
    ).toBe(true);
    expect(pathsOf(itemCreateSchema.safeParse({ ...goods, salesUnitId: bag }))).toEqual([
      'salesUnitId',
    ]);
  });

  it('requires an initial tax rate on create; update has none and applies no defaults', () => {
    expect(pathsOf(itemCreateSchema.safeParse(goodsFields))).toEqual(['taxRateId']);
    expect(itemUpdateSchema.parse({ name: 'TMT bar 8mm Fe500', version: 5 })).toEqual({
      name: 'TMT bar 8mm Fe500',
      version: 5,
    });
    expect(pathsOf(itemUpdateSchema.safeParse({ version: 5 }))).toEqual(['']);
    expect(
      unrecognizedKeysOf(itemUpdateSchema.safeParse({ taxRateId: goods.taxRateId, version: 5 })),
    ).toEqual(['taxRateId']);
  });

  it('adds effective-dated tax rates and filters lists', () => {
    const taxRateId = uuidv7();
    expect(itemTaxRateCreateSchema.parse({ taxRateId, effectiveFrom: '2025-09-22' })).toEqual({
      taxRateId,
      effectiveFrom: '2025-09-22',
    });
    expect(
      unrecognizedKeysOf(
        itemTaxRateCreateSchema.safeParse({ taxRateId, effectiveFrom: '2025-09-22', gstRate: '5' }),
      ),
    ).toEqual(['gstRate']);
    expect(
      itemListQuerySchema.parse({ kind: 'raw_material', active: 'true', sort: 'hsnSac:asc' }),
    ).toMatchObject({ kind: 'raw_material', active: true, sort: 'hsnSac:asc' });
    expect(pathsOf(itemListQuerySchema.safeParse({ sort: 'standardSalesRate:asc' }))).toEqual([
      'sort',
    ]);
  });

  it('parses a DB-shaped item row', () => {
    const row = {
      ...stored,
      hsnSac: '72142090',
      reorderLevel: '0.000000', // numeric(20,6) comes back with its full scale
      reorderQty: '250.000000',
      standardPurchaseRate: '0.000000',
    };
    expect(itemResponseSchema.parse(row)).toEqual(row);
  });
});
