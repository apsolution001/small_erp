import { z } from 'zod';
import { paginationQuerySchema, sortSchema } from '../common/pagination.js';
import {
  isoDateSchema,
  nonNegativeQtySchema,
  positiveQtySchema,
  qtySchema,
  rateSchema,
  recordMetaShape,
  text,
  uuidSchema,
} from '../common/primitives.js';
import { updateSchema } from '../common/update.js';
import { activeFilterSchema } from './shared.js';

export const ITEM_TYPES = ['goods', 'service'] as const;
export const itemTypeSchema = z.enum(ITEM_TYPES);
export type ItemType = z.infer<typeof itemTypeSchema>;

export const ITEM_KINDS = [
  'raw_material',
  'semi_finished',
  'finished_good',
  'trading',
  'consumable',
  'scrap',
  'service',
] as const;
export const itemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof itemKindSchema>;

/** A UoM conversion. The base unit has an implicit factor of 1 and is never listed. */
export const itemUnitSchema = z.strictObject({
  unitId: uuidSchema,
  /** How many base units one of this unit holds, e.g. BAG = 50 when the base is KGS. */
  factorToBase: positiveQtySchema,
});
export type ItemUnit = z.infer<typeof itemUnitSchema>;

const itemFields = {
  code: text(30),
  name: text(200),
  description: text(1000).nullable(),
  itemType: itemTypeSchema,
  itemKind: itemKindSchema,
  categoryId: uuidSchema.nullable(),
  /** HSN (goods) or SAC (services), digits only. Also ≥ company.hsnMinDigits (service check). */
  hsnSac: z.string().regex(/^\d+$/, 'Use digits only'),
  baseUnitId: uuidSchema,
  purchaseUnitId: uuidSchema.nullable(),
  salesUnitId: uuidSchema.nullable(),
  reorderLevel: nonNegativeQtySchema.nullable(),
  reorderQty: nonNegativeQtySchema.nullable(),
  minOrderQty: nonNegativeQtySchema.nullable(),
  trackBatches: z.boolean(),
  trackExpiry: z.boolean(),
  standardPurchaseRate: rateSchema.nullable(),
  standardSalesRate: rateSchema.nullable(),
  isActive: z.boolean(),
  units: z.array(itemUnitSchema),
};

const itemRecordObject = z.object(itemFields);
type ItemRuleInput = z.output<typeof itemRecordObject>;

function checkHsnSac(value: ItemRuleInput, ctx: z.RefinementCtx): void {
  const { itemType, hsnSac } = value;
  const valid =
    itemType === 'goods'
      ? [4, 6, 8].includes(hsnSac.length)
      : hsnSac.length === 6 && hsnSac.startsWith('99');
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      path: ['hsnSac'],
      message:
        itemType === 'goods'
          ? 'HSN must have 4, 6 or 8 digits'
          : 'SAC must have 6 digits and start with 99',
    });
  }
}

function checkUnits(value: ItemRuleInput, ctx: z.RefinementCtx): void {
  const { units, baseUnitId } = value;
  const seen = new Set<string>();
  units.forEach((unit, index) => {
    if (unit.unitId === baseUnitId || seen.has(unit.unitId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['units', index, 'unitId'],
        message:
          unit.unitId === baseUnitId
            ? 'The base unit needs no conversion'
            : 'Each unit can be listed once',
      });
    }
    seen.add(unit.unitId);
  });
  for (const field of ['purchaseUnitId', 'salesUnitId'] as const) {
    const unitId = value[field];
    if (unitId !== null && unitId !== baseUnitId && !seen.has(unitId)) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Use the base unit or a unit with a conversion',
      });
    }
  }
}

/**
 * Item rules (spec 02): expiry tracking needs batch tracking; kind `service` ⇔ type `service`;
 * services have no batches; HSN/SAC shape; UoM conversions and purchase/sales units.
 */
const itemRules = (value: ItemRuleInput, ctx: z.RefinementCtx): void => {
  const { itemType, itemKind, trackBatches, trackExpiry } = value;
  if (trackExpiry && !trackBatches) {
    ctx.addIssue({
      code: 'custom',
      path: ['trackExpiry'],
      message: 'Expiry tracking needs batch tracking',
    });
  }
  if ((itemType === 'service') !== (itemKind === 'service')) {
    ctx.addIssue({
      code: 'custom',
      path: ['itemKind'],
      message: 'Use kind "service" for services, and only for services',
    });
  }
  if (itemType === 'service' && trackBatches) {
    ctx.addIssue({ code: 'custom', path: ['trackBatches'], message: 'Services have no batches' });
  }
  checkHsnSac(value, ctx);
  checkUnits(value, ctx);
};

/** The whole item with its rules. The service parses `{ ...existing, ...patch }` with it. */
export const itemRecordSchema = itemRecordObject.superRefine(itemRules);
export type ItemRecord = z.output<typeof itemRecordSchema>;

/** An effective-dated GST rate of an item: the latest row with `effectiveFrom ≤ date` applies. */
export const itemTaxRateResponseSchema = z.object({
  id: uuidSchema,
  taxRateId: uuidSchema,
  effectiveFrom: isoDateSchema,
});
export type ItemTaxRateResponse = z.infer<typeof itemTaxRateResponseSchema>;

/**
 * `POST /items/:id/tax-rates` (`masters.item_tax_rate:create`). This is how a GST rate changes:
 * tax-rate slabs are immutable in their rates.
 */
export const itemTaxRateCreateSchema = z.strictObject({
  taxRateId: uuidSchema,
  effectiveFrom: isoDateSchema,
});
export type ItemTaxRateCreate = z.infer<typeof itemTaxRateCreateSchema>;

export const itemResponseSchema = z.object({
  ...recordMetaShape,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  itemType: itemTypeSchema,
  itemKind: itemKindSchema,
  categoryId: uuidSchema.nullable(),
  hsnSac: z.string(),
  baseUnitId: uuidSchema,
  purchaseUnitId: uuidSchema.nullable(),
  salesUnitId: uuidSchema.nullable(),
  reorderLevel: qtySchema.nullable(),
  reorderQty: qtySchema.nullable(),
  minOrderQty: qtySchema.nullable(),
  trackBatches: z.boolean(),
  trackExpiry: z.boolean(),
  standardPurchaseRate: rateSchema.nullable(),
  standardSalesRate: rateSchema.nullable(),
  isActive: z.boolean(),
  units: z.array(z.object({ unitId: uuidSchema, factorToBase: qtySchema })),
  taxRates: z.array(itemTaxRateResponseSchema),
});
export type ItemResponse = z.infer<typeof itemResponseSchema>;

/**
 * `POST /items`. `taxRateId` is the initial GST rate. The service stores it with
 * `effectiveFrom` = the company's books-begin date.
 */
export const itemCreateSchema = z
  .strictObject({
    ...itemFields,
    description: itemFields.description.default(null),
    categoryId: itemFields.categoryId.default(null),
    purchaseUnitId: itemFields.purchaseUnitId.default(null),
    salesUnitId: itemFields.salesUnitId.default(null),
    reorderLevel: itemFields.reorderLevel.default(null),
    reorderQty: itemFields.reorderQty.default(null),
    minOrderQty: itemFields.minOrderQty.default(null),
    trackBatches: z.boolean().default(false),
    trackExpiry: z.boolean().default(false),
    standardPurchaseRate: itemFields.standardPurchaseRate.default(null),
    standardSalesRate: itemFields.standardSalesRate.default(null),
    isActive: z.boolean().default(true),
    units: itemFields.units.default([]),
    taxRateId: uuidSchema,
  })
  .superRefine(itemRules);
export type ItemCreate = z.infer<typeof itemCreateSchema>;
export type ItemCreateInput = z.input<typeof itemCreateSchema>;

/** `PATCH /items/:id`. Sending `units` replaces the whole conversion list. */
export const itemUpdateSchema = updateSchema(itemFields);
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;

export const itemListQuerySchema = paginationQuerySchema.extend({
  sort: sortSchema(['code', 'name', 'hsnSac', 'createdAt']).optional(),
  kind: itemKindSchema.optional(),
  type: itemTypeSchema.optional(),
  categoryId: uuidSchema.optional(),
  active: activeFilterSchema,
});
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
