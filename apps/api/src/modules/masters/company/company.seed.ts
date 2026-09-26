import { fyRange } from '@ekaro/core';
import { type NewCompanyProfileRow } from './company-profile.schema.js';

/** What the tenant bootstrap knows about the business: its GST registration and the owner. */
export interface CompanySeed {
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly gstin: string;
  readonly pan: string;
  readonly address: {
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly pincode: string;
    readonly stateCode: string;
  };
  /** Owner's contact details, the company's until they are edited. */
  readonly email: string;
  readonly phone: string | null;
  /** The financial year the books start in (the signup date's FY). */
  readonly fy: string;
}

/** The company profile: registration from the GSTIN, books from the start of the current FY. */
export function buildCompanyProfile(seed: CompanySeed): NewCompanyProfileRow {
  return {
    legalName: seed.legalName,
    tradeName: seed.tradeName,
    gstin: seed.gstin,
    pan: seed.pan,
    stateCode: seed.address.stateCode,
    line1: seed.address.line1,
    line2: seed.address.line2,
    city: seed.address.city,
    pincode: seed.address.pincode,
    email: seed.email,
    phone: seed.phone,
    booksBeginDate: fyRange(seed.fy).start,
  };
}
