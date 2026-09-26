import { type TaxRateResponse } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type TaxRateRow } from './tax-rates.schema.js';

/** A `tax_rates` row as the API returns it. Rates keep their `numeric(7,4)` form (`"18.0000"`). */
export function toTaxRateResponse(row: TaxRateRow): TaxRateResponse {
  return {
    ...recordMetaOf(row),
    name: row.name,
    gstRate: row.gstRate,
    cessRate: row.cessRate,
    isExempt: row.isExempt,
    isNilRated: row.isNilRated,
    isNonGst: row.isNonGst,
    isActive: row.isActive,
  };
}
