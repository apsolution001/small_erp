import {
  branchCreateSchema,
  companyCreateSchema,
  DOC_TYPES,
  documentSeriesCreateSchema,
  godownCreateSchema,
  taxRateCreateSchema,
  unitCreateSchema,
} from '@ekaro/contracts';
import { formatDocNumber, isValidUqc } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { buildHeadOffice } from './branches/branches.seed.js';
import { buildCompanyProfile, type CompanySeed } from './company/company.seed.js';
import {
  buildDefaultSeries,
  DOC_TYPE_SERIES_CODES,
} from './document-series/document-series.seed.js';
import { buildMainGodown } from './godowns/godowns.seed.js';
import { buildDefaultTaxRates } from './tax-rates/tax-rates.seed.js';
import { buildDefaultUnits } from './units/units.seed.js';

const seed: CompanySeed = {
  legalName: 'AAPFU0939F Private Limited',
  tradeName: 'AAPFU0939F Traders',
  gstin: '27AAPFU0939F1ZV',
  pan: 'AAPFU0939F',
  address: {
    line1: 'Unit 0939, Industrial Estate',
    line2: null,
    city: 'Maharashtra',
    pincode: '400939',
    stateCode: '27',
  },
  email: 'owner@example.com',
  phone: '+919876543210',
  fy: '2026-27',
};
const BRANCH_ID = '01920000-0000-7000-8000-000000000001';

describe('buildCompanyProfile', () => {
  it('takes the registration from the GSTIN lookup and starts the books at the FY start', () => {
    expect(buildCompanyProfile(seed)).toEqual({
      legalName: 'AAPFU0939F Private Limited',
      tradeName: 'AAPFU0939F Traders',
      gstin: '27AAPFU0939F1ZV',
      pan: 'AAPFU0939F',
      stateCode: '27',
      line1: 'Unit 0939, Industrial Estate',
      line2: null,
      city: 'Maharashtra',
      pincode: '400939',
      email: 'owner@example.com',
      phone: '+919876543210',
      booksBeginDate: '2026-04-01',
    });
  });

  it('satisfies the contracts company rules (GSTIN state and PAN consistent)', () => {
    expect(companyCreateSchema.safeParse(buildCompanyProfile(seed)).success).toBe(true);
  });
});

describe('buildHeadOffice / buildMainGodown', () => {
  it('creates the HO branch at the registered address, with the company GSTIN', () => {
    const ho = buildHeadOffice(seed);
    expect(ho).toMatchObject({
      code: 'HO',
      name: 'Head Office',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
      isHeadOffice: true,
    });
    expect(branchCreateSchema.safeParse(ho).success).toBe(true);
  });

  it('creates the Main godown in the given branch', () => {
    const godown = buildMainGodown(BRANCH_ID);
    expect(godown).toEqual({ branchId: BRANCH_ID, code: 'MAIN', name: 'Main' });
    expect(godownCreateSchema.safeParse(godown).success).toBe(true);
  });
});

describe('buildDefaultUnits', () => {
  it('seeds exactly the spec 02 §4 units, each mapped to its own UQC', () => {
    const units = buildDefaultUnits();
    expect(units.map((u) => u.code)).toEqual([
      'NOS',
      'PCS',
      'KGS',
      'GMS',
      'TON',
      'MTR',
      'CMS',
      'LTR',
      'MLT',
      'BOX',
      'BAG',
      'SET',
      'PAC',
      'ROL',
      'SQM',
      'SQF',
      'DOZ',
      'OTH',
    ]);
    for (const unit of units) {
      expect(unit.uqc).toBe(unit.code);
      expect(isValidUqc(unit.uqc)).toBe(true);
      expect(unitCreateSchema.safeParse(unit).success, unit.code).toBe(true);
    }
  });

  it('allows decimals only for measured units', () => {
    const places = Object.fromEntries(buildDefaultUnits().map((u) => [u.code, u.decimalPlaces]));
    expect(places).toMatchObject({ NOS: 0, PCS: 0, DOZ: 0, KGS: 3, LTR: 3, MTR: 2, SQF: 2 });
    expect(buildDefaultUnits().find((u) => u.code === 'KGS')?.name).toBe('Kilograms');
  });
});

describe('buildDefaultTaxRates', () => {
  it('seeds nil, exempt and the current slabs active, with 12% and 28% inactive', () => {
    expect(
      buildDefaultTaxRates().map((r) => [r.name, r.gstRate, r.isExempt, r.isNilRated, r.isActive]),
    ).toEqual([
      ['Nil Rated', '0', false, true, true],
      ['Exempt', '0', true, false, true],
      ['GST 0.25%', '0.25', false, false, true],
      ['GST 1.5%', '1.5', false, false, true],
      ['GST 3%', '3', false, false, true],
      ['GST 5%', '5', false, false, true],
      ['GST 18%', '18', false, false, true],
      ['GST 40%', '40', false, false, true],
      ['GST 12%', '12', false, false, false],
      ['GST 28%', '28', false, false, false],
    ]);
  });

  it('satisfies the contracts slab rules, without cess or non-GST slabs', () => {
    for (const rate of buildDefaultTaxRates()) {
      expect(rate).toMatchObject({ cessRate: '0', isNonGst: false });
      expect(taxRateCreateSchema.safeParse(rate).success, rate.name).toBe(true);
    }
  });
});

describe('buildDefaultSeries', () => {
  const series = buildDefaultSeries(BRANCH_ID, '2026-27');

  it('creates one default series per document type for the branch and FY', () => {
    expect(series.map((s) => s.docType)).toEqual([...DOC_TYPES]);
    for (const s of series) {
      expect(s).toMatchObject({
        branchId: BRANCH_ID,
        fy: '2026-27',
        suffix: '',
        padding: 4,
        nextNumber: 1n,
        isDefault: true,
      });
    }
  });

  it('renders numbers like SI/26-27/0001 and PO/26-27/0001', () => {
    const first = (docType: string) => {
      const s = series.find((x) => x.docType === docType);
      if (s === undefined) throw new Error(docType);
      return formatDocNumber({ prefix: s.prefix, suffix: s.suffix ?? '', padding: 4 }, 1n);
    };
    expect(first('sales_invoice')).toBe('SI/26-27/0001');
    expect(first('purchase_order')).toBe('PO/26-27/0001');
    expect(first('job_work_out')).toBe('JWO/26-27/0001');
  });

  it('uses distinct codes, and every series passes the 16-character rule', () => {
    const codes = Object.values(DOC_TYPE_SERIES_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of series) {
      const parsed = documentSeriesCreateSchema.safeParse({ ...s, nextNumber: '1' });
      expect(parsed.success, s.docType).toBe(true);
    }
  });

  it('follows the FY it is given', () => {
    expect(buildDefaultSeries(BRANCH_ID, '2027-28')[0]?.prefix).toBe('PR/27-28/');
  });
});
