import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import {
  familyOf,
  findOverlappingSeries,
  issuingGstin,
  type SeriesShape,
} from './document-series.rules.js';

const HO_GSTIN = '27AAPFU0939F1ZV';
const KA_GSTIN = '29AAPFU0939F1ZR';

/** A series that is not stored yet (no id). */
const candidate = (overrides: Partial<Omit<SeriesShape, 'id'>> = {}): SeriesShape => ({
  branchGstin: HO_GSTIN,
  docType: 'sales_invoice',
  fy: '2026-27',
  prefix: 'SI/26-27/',
  suffix: '',
  padding: 4,
  ...overrides,
});

/** A stored series. */
const series = (overrides: Partial<Omit<SeriesShape, 'id'>> = {}): SeriesShape => ({
  id: uuidv7(),
  ...candidate(overrides),
});

describe('document series rules', () => {
  it('groups credit and debit notes, and keeps other types apart', () => {
    expect(familyOf('credit_note')).toEqual(['debit_note', 'credit_note']);
    expect(familyOf('sales_invoice')).toEqual(['sales_invoice']);
    expect(familyOf('grn')).toEqual(['grn']);
  });

  it("issues under the branch's GSTIN, else the company's", () => {
    expect(issuingGstin(KA_GSTIN, HO_GSTIN)).toBe(KA_GSTIN);
    expect(issuingGstin(null, HO_GSTIN)).toBe(HO_GSTIN);
    expect(issuingGstin(null, null)).toBeNull();
  });

  it('finds a series of the same GSTIN, family and FY that renders the same numbers', () => {
    const ho = series();
    // Another branch without its own GSTIN issues under the company's: SI/26-27/0001 again.
    const sameGstin = candidate({ branchGstin: null, padding: 5 });
    expect(findOverlappingSeries(sameGstin, [ho], HO_GSTIN)).toBe(ho);
    // A note series may not repeat a debit note number.
    const dn = series({ docType: 'debit_note', prefix: 'CN/' });
    expect(
      findOverlappingSeries(series({ docType: 'credit_note', prefix: 'CN/' }), [dn], HO_GSTIN),
    ).toBe(dn);
  });

  it('allows the same pattern under another GSTIN, family or FY, or with distinct numbers', () => {
    const ho = series();
    const candidates = [
      candidate({ branchGstin: KA_GSTIN }),
      candidate({ docType: 'delivery_challan' }),
      candidate({ fy: '2027-28' }),
      candidate({ prefix: 'SI/26-27/B' }),
    ];
    for (const other of candidates) {
      expect(findOverlappingSeries(other, [ho], HO_GSTIN)).toBeUndefined();
    }
  });

  it('never reports a series against itself', () => {
    const ho = series();
    expect(findOverlappingSeries({ ...ho, padding: 5 }, [ho], HO_GSTIN)).toBeUndefined();
  });
});
