import { type UnitResponse } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type UnitRow } from './units.schema.js';

/** A `units` row as the API returns it (`unitResponseSchema`). */
export function toUnitResponse(row: UnitRow): UnitResponse {
  return {
    ...recordMetaOf(row),
    code: row.code,
    name: row.name,
    uqc: row.uqc,
    decimalPlaces: row.decimalPlaces,
    isActive: row.isActive,
  };
}
