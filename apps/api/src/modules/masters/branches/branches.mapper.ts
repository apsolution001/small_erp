import { type BranchResponse, stateCodeSchema } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type BranchRow } from './branches.schema.js';

export function toBranchResponse(row: BranchRow): BranchResponse {
  return {
    ...recordMetaOf(row),
    code: row.code,
    name: row.name,
    gstin: row.gstin,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    pincode: row.pincode,
    // char(2) in the table (format-checked); the list of codes lives in @ekaro/core.
    stateCode: stateCodeSchema.parse(row.stateCode),
    isHeadOffice: row.isHeadOffice,
    isActive: row.isActive,
  };
}
