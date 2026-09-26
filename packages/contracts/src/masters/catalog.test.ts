import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import {
  itemCategoryCreateSchema,
  itemCategoryListQuerySchema,
  itemCategoryTreeNodeSchema,
} from './item-category.js';
import {
  itemCreateSchema,
  itemListQuerySchema,
  itemTaxRateCreateSchema,
  itemUpdateSchema,
} from './item.js';
import { taxRateCreateSchema } from './tax-rate.js';
import { unitCreateSchema } from './unit.js';

const pathsOf = (result: { error?: { issues: { path: PropertyKey[] }[] } | undefined }): string[] =>
  (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('unitCreateSchema', () => {
  it('upper-cases the code and maps to a GST UQC', () => {
    expect(unitCreateSchema.parse({ code: 'bag', name: 'Bag of 50 kg', uqc: 'BAG' })).toEqual({
      code: 'BAG',
      name: 'Bag of 50 kg',
      uqc: 'BAG',
      decimalPlaces: 0,
      isActive: true,
    });
  });

  it('rejects unknown UQCs, long codes and more than 6 decimal places', () => {
    expect(unitCreateSchema.safeParse({ code: 'BAG', name: 'Bag', uqc: 'SACK' }).success).toBe(
      false,
    );
    expect(unitCreateSchema.safeParse({ code: 'ABCDEFGHIJK', name: 'X', uqc: 'OTH' }).success).toBe(
      false,
    );
    expect(
      unitCreateSchema.safeParse({ code: 'KG', name: 'Kilo', uqc: 'KGS', decimalPlaces: 7 })
        .success,
    ).toBe(false);
  });
});

describe('taxRateCreateSchema', () => {
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
        taxRateCreateSchema.safeParse({
          name: 'Bad',
          gstRate: '0',
          isExempt: true,
          isNilRated: true,
        }),
      ),
    ).toEqual(['isNilRated']);
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

  it('parses a nested tree', () => {
    const leaf = { id: uuidv7(), name: 'TMT bars', parentId: null, isActive: true, children: [] };
    const tree = { ...leaf, name: 'Steel', children: [leaf] };
    expect(itemCategoryTreeNodeSchema.parse(tree)).toEqual(tree);
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
    expect(
      pathsOf(itemUpdateSchema.safeParse({ trackBatches: false, trackExpiry: true, version: 1 })),
    ).toEqual(['trackExpiry']);
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
  });

  it('an update that replaces units without the base unit still rejects duplicates', () => {
    const units = [
      { unitId: bag, factorToBase: '50' },
      { unitId: bag, factorToBase: '25' },
    ];
    expect(pathsOf(itemUpdateSchema.safeParse({ units, salesUnitId: bag, version: 1 }))).toEqual([
      'units.1.unitId',
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

  it('requires an initial tax rate on create but not on update', () => {
    const { taxRateId: _omit, ...withoutRate } = goods;
    expect(pathsOf(itemCreateSchema.safeParse(withoutRate))).toEqual(['taxRateId']);
    expect(itemUpdateSchema.parse({ name: 'TMT bar 8mm Fe500', version: 5 })).toEqual({
      name: 'TMT bar 8mm Fe500',
      version: 5,
    });
  });

  it('adds effective-dated tax rates and filters lists', () => {
    const taxRateId = uuidv7();
    expect(itemTaxRateCreateSchema.parse({ taxRateId, effectiveFrom: '2025-09-22' })).toEqual({
      taxRateId,
      effectiveFrom: '2025-09-22',
    });
    expect(itemListQuerySchema.parse({ kind: 'raw_material', active: 'true' })).toMatchObject({
      kind: 'raw_material',
      active: true,
    });
  });
});
