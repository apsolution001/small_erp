import { type ItemRecord, type ItemResponse, type ItemTaxRateResponse } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type ItemTaxRateRow } from './item-tax-rates.schema.js';
import { type ItemUnitRow } from './item-units.schema.js';
import { type ItemRow } from './items.schema.js';

/** The item as a record (`itemRecordSchema`): its own fields and its conversions. */
export function toItemRecord(row: ItemRow, units: readonly ItemUnitRow[]): ItemRecord {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    itemType: row.itemType,
    itemKind: row.itemKind,
    categoryId: row.categoryId,
    hsnSac: row.hsnSac,
    baseUnitId: row.baseUnitId,
    purchaseUnitId: row.purchaseUnitId,
    salesUnitId: row.salesUnitId,
    reorderLevel: row.reorderLevel,
    reorderQty: row.reorderQty,
    minOrderQty: row.minOrderQty,
    trackBatches: row.trackBatches,
    trackExpiry: row.trackExpiry,
    standardPurchaseRate: row.standardPurchaseRate,
    standardSalesRate: row.standardSalesRate,
    isActive: row.isActive,
    units: units.map((u) => ({ unitId: u.unitId, factorToBase: u.factorToBase })),
  };
}

export function toItemTaxRateResponse(row: ItemTaxRateRow): ItemTaxRateResponse {
  return { id: row.id, taxRateId: row.taxRateId, effectiveFrom: row.effectiveFrom };
}

/**
 * An item as the API returns it, with its conversions and its effective-dated tax rates (oldest
 * first). Quantities and rates keep their `numeric(20,6)` form (`"50.000000"`).
 */
export function toItemResponse(
  row: ItemRow,
  units: readonly ItemUnitRow[],
  taxRates: readonly ItemTaxRateRow[],
): ItemResponse {
  return {
    ...recordMetaOf(row),
    ...toItemRecord(row, units),
    taxRates: taxRates.map(toItemTaxRateResponse),
  };
}
