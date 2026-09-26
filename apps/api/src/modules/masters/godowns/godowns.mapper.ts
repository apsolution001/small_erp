import { type GodownResponse } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type GodownRow } from './godowns.schema.js';

export function toGodownResponse(row: GodownRow): GodownResponse {
  return {
    ...recordMetaOf(row),
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    address: row.address,
    allowNegativeStock: row.allowNegativeStock,
    isActive: row.isActive,
  };
}
