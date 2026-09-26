import { DOC_TYPES, type DocType, docNumberFamily } from '@ekaro/contracts';
import { seriesNumbersCollide } from '@ekaro/core';

/** A series as the overlap rule sees it. `branchGstin` is its branch's own GSTIN, if any. */
export interface SeriesShape {
  readonly id?: string;
  readonly branchGstin: string | null;
  readonly docType: DocType;
  readonly fy: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly padding: number;
}

/** The document types whose numbers share a space with `docType` (its GSTR-1 family). */
export function familyOf(docType: DocType): DocType[] {
  const family = docNumberFamily(docType);
  return DOC_TYPES.filter((t) => docNumberFamily(t) === family);
}

/**
 * The GSTIN a branch issues documents under: its own registration, else the company's (a branch
 * in the company's state without a separate registration). Null only for an unregistered
 * business, whose branches then share one number space.
 */
export function issuingGstin(
  branchGstin: string | null,
  companyGstin: string | null,
): string | null {
  return branchGstin ?? companyGstin;
}

/**
 * The first existing series that could render a number `candidate` also renders under the same
 * GSTIN, document family and FY (spec 02 §2), or undefined. `existing` holds series of the same
 * FY and family; the candidate itself (same id) is skipped.
 */
export function findOverlappingSeries<T extends SeriesShape>(
  candidate: SeriesShape,
  existing: readonly T[],
  companyGstin: string | null,
): T | undefined {
  const family = docNumberFamily(candidate.docType);
  const gstin = issuingGstin(candidate.branchGstin, companyGstin);
  return existing.find(
    (other) =>
      other.id !== candidate.id &&
      other.fy === candidate.fy &&
      docNumberFamily(other.docType) === family &&
      issuingGstin(other.branchGstin, companyGstin) === gstin &&
      seriesNumbersCollide(candidate, other),
  );
}
