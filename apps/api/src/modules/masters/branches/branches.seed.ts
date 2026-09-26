import { type CompanySeed } from '../company/company.seed.js';
import { type NewBranchRow } from './branches.schema.js';

export const HEAD_OFFICE_CODE = 'HO';

/** The head-office branch, at the GSTIN's principal place of business. */
export function buildHeadOffice(seed: CompanySeed): NewBranchRow {
  return {
    code: HEAD_OFFICE_CODE,
    name: 'Head Office',
    gstin: seed.gstin,
    stateCode: seed.address.stateCode,
    line1: seed.address.line1,
    line2: seed.address.line2,
    city: seed.address.city,
    pincode: seed.address.pincode,
    isHeadOffice: true,
  };
}
