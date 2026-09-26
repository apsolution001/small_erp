import { type DocumentSeriesResponse } from '@ekaro/contracts';
import { recordMetaOf } from '../../../infra/db/record-meta.js';
import { type DocumentSeriesRow } from './document-series.schema.js';

/** Numbers are `bigint` columns and travel as strings (they can exceed 2^53). */
export function toDocumentSeriesResponse(row: DocumentSeriesRow): DocumentSeriesResponse {
  return {
    ...recordMetaOf(row),
    branchId: row.branchId,
    docType: row.docType,
    fy: row.fy,
    prefix: row.prefix,
    suffix: row.suffix,
    padding: row.padding,
    nextNumber: row.nextNumber.toString(),
    lastIssuedNumber: row.lastIssuedNumber === null ? null : row.lastIssuedNumber.toString(),
    isDefault: row.isDefault,
  };
}
