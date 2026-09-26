import {
  type ItemCreate,
  type ItemListQuery,
  type ItemRecord,
  itemRecordSchema,
  type ItemResponse,
  type ItemTaxRateCreate,
  type ItemTaxRateListQuery,
  type ItemTaxRateResponse,
  type ItemUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  type FieldError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import { type ConstraintErrors, mapConstraintErrors } from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { CompanyService } from '../company/company.service.js';
import { ItemCategoriesService } from '../item-categories/item-categories.service.js';
import { UnitsService } from '../units/units.service.js';
import { type ItemTaxRateRow } from './item-tax-rates.schema.js';
import { type ItemUnitRow } from './item-units.schema.js';
import { toItemRecord, toItemResponse, toItemTaxRateResponse } from './items.mapper.js';
import { ItemsRepository } from './items.repository.js';
import { type ItemRow } from './items.schema.js';

const unknownReference = (path: string, what: string) => (): ValidationError =>
  ValidationError.forField(path, `The ${what} does not exist`);

/**
 * Foreign keys are the last line of defence behind the active-reference checks below (a row
 * deleted by a concurrent request); each maps to the field that names the missing row.
 */
const constraintErrors = (code: string | undefined): ConstraintErrors => ({
  items_tenant_code_unique: () =>
    new ConflictError('ALREADY_EXISTS', `An item with code ${code ?? ''} already exists.`),
  items_category_fk: unknownReference('categoryId', 'category'),
  items_base_unit_fk: unknownReference('baseUnitId', 'unit'),
  items_purchase_unit_fk: unknownReference('purchaseUnitId', 'unit'),
  items_sales_unit_fk: unknownReference('salesUnitId', 'unit'),
  item_units_unit_fk: unknownReference('units', 'unit'),
  item_tax_rates_tax_rate_fk: unknownReference('taxRateId', 'tax slab'),
});

/** HSN/SAC length against the company setting (4 up to ₹5 crore turnover, 6 above). */
export function hsnDigitsError(hsnSac: string, minDigits: number): FieldError | undefined {
  return hsnSac.length < minDigits
    ? {
        path: 'hsnSac',
        message: `HSN/SAC must have at least ${minDigits} digits (company setting)`,
        code: 'custom',
      }
    : undefined;
}

/** Every unit an item record refers to, with the path of the field that refers to it. */
function unitReferences(record: ItemRecord): [string, string][] {
  const refs: [string, string][] = [['baseUnitId', record.baseUnitId]];
  if (record.purchaseUnitId !== null) refs.push(['purchaseUnitId', record.purchaseUnitId]);
  if (record.salesUnitId !== null) refs.push(['salesUnitId', record.salesUnitId]);
  record.units.forEach((u, i) => refs.push([`units.${i}.unitId`, u.unitId]));
  return refs;
}

/**
 * Items (MS-02, spec 02): nested UoM conversions and effective-dated GST rates. Cross-field rules
 * come from `itemRecordSchema` (on the merged record for a PATCH); the rules that need other data
 * are here: HSN length ≥ the company's `hsnMinDigits`, and a newly referenced unit or category
 * must be active. Items are never deleted: DELETE deactivates. Tax-rate rows are only added.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly items: ItemsRepository,
    private readonly company: CompanyService,
    private readonly units: UnitsService,
    private readonly categories: ItemCategoriesService,
  ) {}

  async list(query: ItemListQuery): Promise<Page<ItemResponse>> {
    const { rows, total } = await this.items.list(query);
    return pageOf(await this.withChildren(rows), total, query);
  }

  async get(id: string): Promise<ItemResponse> {
    const [item] = await this.withChildren([await this.require(id)]);
    if (item === undefined) throw notFound();
    return item;
  }

  async create(input: ItemCreate): Promise<ItemResponse> {
    const { taxRateId, units, ...fields } = input;
    const settings = await this.company.settings();
    await this.assertRules(input, undefined, settings.hsnMinDigits);
    const errors = constraintErrors(fields.code);
    const row = await mapConstraintErrors(() => this.items.insert(fields), errors);
    await mapConstraintErrors(() => this.items.replaceUnits(row.id, units), errors);
    await mapConstraintErrors(
      () =>
        this.items.insertTaxRate({
          itemId: row.id,
          taxRateId,
          effectiveFrom: settings.booksBeginDate,
        }),
      errors,
    );
    return this.get(row.id);
  }

  async update(id: string, patch: ItemUpdate): Promise<ItemResponse> {
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    const previous = toItemRecord(existing, await this.items.unitsOf([id]));
    const merged = parseMergedRecord(itemRecordSchema, previous, changes);
    // An HSN stored under an older, lower company minimum stays valid until the HSN is edited.
    const hsnMinDigits =
      changes.hsnSac === undefined ? 0 : (await this.company.settings()).hsnMinDigits;
    await this.assertRules(merged, previous, hsnMinDigits);
    const { units, ...itemChanges } = changes;
    const errors = constraintErrors(changes.code);
    await mapConstraintErrors(() => this.items.update(id, itemChanges), errors);
    if (units !== undefined) {
      await mapConstraintErrors(() => this.items.replaceUnits(id, units), errors);
    }
    return this.get(id);
  }

  /** Deactivates the item (masters are never hard deleted once they can be referenced). */
  async remove(id: string): Promise<void> {
    const existing = await this.require(id, { forUpdate: true });
    if (existing.isActive) await this.items.update(id, { isActive: false });
  }

  /** Every rate row of the item, or with `on` only the row in force that day. */
  async taxRates(id: string, query: ItemTaxRateListQuery): Promise<ItemTaxRateResponse[]> {
    await this.require(id);
    if (query.on === undefined) {
      return (await this.items.taxRatesOf([id])).map(toItemTaxRateResponse);
    }
    const row = await this.items.taxRateOn(id, query.on);
    return row === undefined ? [] : [toItemTaxRateResponse(row)];
  }

  /**
   * Adds an effective-dated rate: how an item's GST changes (slabs are immutable). The date may
   * not precede the books, and one item has at most one row per date.
   */
  async addTaxRate(id: string, input: ItemTaxRateCreate): Promise<ItemTaxRateResponse> {
    await this.require(id);
    const { booksBeginDate } = await this.company.settings();
    if (input.effectiveFrom < booksBeginDate) {
      throw ValidationError.forField(
        'effectiveFrom',
        `A rate cannot start before the books begin (${booksBeginDate})`,
      );
    }
    const row = await mapConstraintErrors(
      () => this.items.insertTaxRate({ itemId: id, ...input }),
      {
        item_tax_rates_item_effective_unique: () =>
          new ConflictError(
            'ALREADY_EXISTS',
            `This item already has a tax rate from ${input.effectiveFrom}.`,
          ),
        item_tax_rates_tax_rate_fk: unknownReference('taxRateId', 'tax slab'),
      },
    );
    return toItemTaxRateResponse(row);
  }

  /**
   * The rules that need other data. Only references the record newly makes are checked for
   * being active, so an item keeps working after one of its units is deactivated.
   */
  private async assertRules(
    next: ItemRecord,
    previous: ItemRecord | undefined,
    hsnMinDigits: number,
  ): Promise<void> {
    const errors: FieldError[] = [];
    const hsn = hsnDigitsError(next.hsnSac, hsnMinDigits);
    if (hsn !== undefined) errors.push(hsn);

    const known = new Set(
      previous === undefined ? [] : unitReferences(previous).map(([, id]) => id),
    );
    const fresh = unitReferences(next).filter(([, unitId]) => !known.has(unitId));
    const active = await this.units.findActiveIds([...new Set(fresh.map(([, unitId]) => unitId))]);
    for (const [path, unitId] of fresh) {
      if (!active.has(unitId))
        errors.push({ path, message: 'Choose an active unit', code: 'custom' });
    }

    const { categoryId } = next;
    if (categoryId !== null && categoryId !== previous?.categoryId) {
      const activeCategories = await this.categories.findActiveIds([categoryId]);
      if (!activeCategories.has(categoryId)) {
        errors.push({ path: 'categoryId', message: 'Choose an active category', code: 'custom' });
      }
    }
    if (errors.length > 0) throw new ValidationError(errors);
  }

  private async withChildren(rows: readonly ItemRow[]): Promise<ItemResponse[]> {
    const ids = rows.map((r) => r.id);
    const units = groupBy(await this.items.unitsOf(ids));
    const rates = groupBy(await this.items.taxRatesOf(ids));
    return rows.map((row) => toItemResponse(row, units.get(row.id) ?? [], rates.get(row.id) ?? []));
  }

  private async require(id: string, options: { forUpdate?: boolean } = {}): Promise<ItemRow> {
    const row = await this.items.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

function groupBy<T extends ItemUnitRow | ItemTaxRateRow>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.itemId);
    if (group === undefined) groups.set(row.itemId, [row]);
    else group.push(row);
  }
  return groups;
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Item not found.');
