import { DOC_TYPES, type DocType } from '@ekaro/contracts';
import { fyShort, validateSeries } from '@ekaro/core';
import { type NewDocumentSeriesRow } from './document-series.schema.js';

/** Short code of each document type, the start of its default prefix (`SI/26-27/`). */
export const DOC_TYPE_SERIES_CODES: Readonly<Record<DocType, string>> = {
  purchase_requisition: 'PR',
  purchase_order: 'PO',
  grn: 'GRN',
  purchase_invoice: 'PI',
  debit_note: 'DN',
  quotation: 'QT',
  sales_order: 'SO',
  delivery_challan: 'DC',
  sales_invoice: 'SI',
  credit_note: 'CN',
  stock_transfer: 'ST',
  stock_adjustment: 'SA',
  work_order: 'WO',
  material_issue: 'MI',
  production_entry: 'PE',
  job_work_out: 'JWO',
  job_work_in: 'JWI',
  payment: 'PMT',
  receipt: 'RCT',
  contra: 'CTR',
  journal: 'JV',
};

export const DEFAULT_SERIES_PADDING = 4;

/**
 * The default series of every document type for one branch and FY (spec 02 §4): prefix
 * `<code>/<yy-yy>/`, no suffix, padding 4, starting at 1. Throws if a format would break GST
 * rule 46, which the codes above never do (the longest, `JWO/26-27/0001`, has 14 characters).
 */
export function buildDefaultSeries(branchId: string, fy: string): NewDocumentSeriesRow[] {
  return DOC_TYPES.map((docType) => {
    const series = {
      prefix: `${DOC_TYPE_SERIES_CODES[docType]}/${fyShort(fy)}/`,
      suffix: '',
      padding: DEFAULT_SERIES_PADDING,
    };
    const issues = validateSeries({ ...series, nextNumber: 1n });
    if (issues.length > 0) {
      throw new Error(`Invalid default series for ${docType}: ${JSON.stringify(issues)}`);
    }
    return { branchId, docType, fy, ...series, nextNumber: 1n, isDefault: true };
  });
}
