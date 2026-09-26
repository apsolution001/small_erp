import {
  type TaxRateCreate,
  type TaxRateListQuery,
  taxRateRecordSchema,
  type TaxRateResponse,
  type TaxRateUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import {
  deleteUnlessReferenced,
  mapConstraintErrors,
} from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { toTaxRateResponse } from './tax-rates.mapper.js';
import { TaxRatesRepository } from './tax-rates.repository.js';
import { type TaxRateRow } from './tax-rates.schema.js';

const duplicateSlab = (): ConflictError =>
  new ConflictError(
    'ALREADY_EXISTS',
    'A tax slab with the same GST rate, cess rate and exempt/nil/non-GST flags already exists.',
  );

/**
 * GST slabs (spec 02 §2–3). A slab is immutable in its rates: the update schema accepts only
 * `name` and `isActive`, and a database trigger backs that up. A rate change is a new slab plus an
 * effective-dated item tax rate. A slab that an item has ever used cannot be deleted (409 IN_USE).
 */
@Injectable()
export class TaxRatesService {
  constructor(private readonly taxRates: TaxRatesRepository) {}

  async list(query: TaxRateListQuery): Promise<Page<TaxRateResponse>> {
    const { rows, total } = await this.taxRates.list(query);
    return pageOf(rows.map(toTaxRateResponse), total, query);
  }

  async get(id: string): Promise<TaxRateResponse> {
    return toTaxRateResponse(await this.require(id));
  }

  async create(input: TaxRateCreate): Promise<TaxRateResponse> {
    const row = await mapConstraintErrors(() => this.taxRates.insert(input), {
      tax_rates_tenant_slab_unique: duplicateSlab,
    });
    return toTaxRateResponse(row);
  }

  async update(id: string, patch: TaxRateUpdate): Promise<TaxRateResponse> {
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    parseMergedRecord(taxRateRecordSchema, toTaxRateResponse(existing), changes);
    return toTaxRateResponse(await this.taxRates.update(id, changes));
  }

  async remove(id: string): Promise<void> {
    const deleted = await deleteUnlessReferenced(() => this.taxRates.delete(id), 'tax slab');
    if (!deleted) throw notFound();
  }

  private async require(id: string, options: { forUpdate?: boolean } = {}): Promise<TaxRateRow> {
    const row = await this.taxRates.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Tax slab not found.');
