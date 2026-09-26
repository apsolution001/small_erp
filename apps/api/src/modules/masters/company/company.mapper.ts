import { type CompanyResponse, hsnMinDigitsSchema, stateCodeSchema } from '@ekaro/contracts';
import { type CompanyProfileRow } from './company-profile.schema.js';

/** The company profile as `GET /company` returns it (keyed by the tenant, so no `id`). */
export function toCompanyResponse(row: CompanyProfileRow): CompanyResponse {
  return {
    legalName: row.legalName,
    tradeName: row.tradeName,
    gstin: row.gstin,
    pan: row.pan,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    pincode: row.pincode,
    // char(2) in the table (format-checked); the list of codes lives in @ekaro/core.
    stateCode: stateCodeSchema.parse(row.stateCode),
    email: row.email,
    phone: row.phone,
    booksBeginDate: row.booksBeginDate,
    valuationMethod: row.valuationMethod,
    allowNegativeStock: row.allowNegativeStock,
    roundOffSales: row.roundOffSales,
    // smallint in the table, 4 | 6 by a check constraint.
    hsnMinDigits: hsnMinDigitsSchema.parse(row.hsnMinDigits),
    eInvoiceEnabled: row.eInvoiceEnabled,
    logoObjectKey: row.logoObjectKey,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
