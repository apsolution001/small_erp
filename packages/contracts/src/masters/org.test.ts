import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { branchCreateSchema, branchListQuerySchema, branchUpdateSchema } from './branch.js';
import { companyCreateSchema, companyUpdateSchema } from './company.js';
import { DOC_TYPES } from './doc-types.js';
import {
  documentSeriesCreateSchema,
  documentSeriesListQuerySchema,
  documentSeriesUpdateSchema,
} from './document-series.js';
import { godownCreateSchema, godownListQuerySchema } from './godown.js';

const pathsOf = (result: { error?: { issues: { path: PropertyKey[] }[] } | undefined }): string[] =>
  (result.error?.issues ?? []).map((i) => i.path.join('.'));

const address = { line1: '12 MG Road', city: 'Pune', pincode: '411001', stateCode: '27' };

describe('companyCreateSchema', () => {
  const company = {
    legalName: 'Acme Traders LLP',
    gstin: '27AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
    ...address,
    booksBeginDate: '2026-04-01',
  };

  it('applies the spec 02 defaults', () => {
    expect(companyCreateSchema.parse(company)).toEqual({
      ...company,
      tradeName: null,
      line2: null,
      email: null,
      phone: null,
      valuationMethod: 'weighted_average',
      allowNegativeStock: false,
      roundOffSales: true,
      hsnMinDigits: 4,
      eInvoiceEnabled: false,
    });
  });

  it('allows an unregistered business (no GSTIN)', () => {
    expect(companyCreateSchema.safeParse({ ...company, gstin: null, pan: null }).success).toBe(
      true,
    );
  });

  it('requires the GSTIN state to equal the company state', () => {
    expect(pathsOf(companyCreateSchema.safeParse({ ...company, stateCode: '29' }))).toEqual([
      'gstin',
    ]);
  });

  it('requires the PAN to match the PAN inside the GSTIN', () => {
    expect(pathsOf(companyCreateSchema.safeParse({ ...company, pan: 'AAGCB7383J' }))).toEqual([
      'pan',
    ]);
  });

  it('only allows 4 or 6 HSN digits', () => {
    expect(companyCreateSchema.safeParse({ ...company, hsnMinDigits: 8 }).success).toBe(false);
  });

  it('updates partially without applying defaults, and checks GSTIN vs state when both are sent', () => {
    expect(companyUpdateSchema.parse({ roundOffSales: false, version: 4 })).toEqual({
      roundOffSales: false,
      version: 4,
    });
    expect(
      pathsOf(
        companyUpdateSchema.safeParse({ gstin: '29AAGCB7383J1Z4', stateCode: '27', version: 1 }),
      ),
    ).toEqual(['gstin']);
    expect(companyUpdateSchema.safeParse({ gstin: '29AAGCB7383J1Z4', version: 1 }).success).toBe(
      true,
    );
  });
});

describe('branch schemas', () => {
  it('defaults gstin, head-office and active flags', () => {
    expect(branchCreateSchema.parse({ code: 'HO', name: 'Head office', ...address })).toEqual({
      code: 'HO',
      name: 'Head office',
      gstin: null,
      line2: null,
      ...address,
      isHeadOffice: false,
      isActive: true,
    });
  });

  it('a branch GSTIN must be registered in the branch state', () => {
    const karnataka = { code: 'BLR', name: 'Bengaluru', ...address, stateCode: '29' };
    expect(branchCreateSchema.safeParse({ ...karnataka, gstin: '29AAGCB7383J1Z4' }).success).toBe(
      true,
    );
    expect(
      pathsOf(branchCreateSchema.safeParse({ ...karnataka, gstin: '27AAPFU0939F1ZV' })),
    ).toEqual(['gstin']);
  });

  it('limits the code to 10 characters', () => {
    expect(
      branchCreateSchema.safeParse({ code: 'ABCDEFGHIJK', name: 'X', ...address }).success,
    ).toBe(false);
  });

  it('updates with a version and filters lists by active', () => {
    expect(branchUpdateSchema.parse({ isActive: false, version: 2 })).toEqual({
      isActive: false,
      version: 2,
    });
    expect(branchListQuerySchema.parse({ active: 'false' }).active).toBe(false);
  });
});

describe('godown schemas', () => {
  it('belongs to a branch and blocks negative stock by default', () => {
    const branchId = uuidv7();
    expect(godownCreateSchema.parse({ branchId, code: 'MAIN', name: 'Main' })).toEqual({
      branchId,
      code: 'MAIN',
      name: 'Main',
      address: null,
      allowNegativeStock: false,
      isActive: true,
    });
    expect(godownListQuerySchema.parse({ branchId }).branchId).toBe(branchId);
  });
});

describe('document series schemas', () => {
  const branchId = uuidv7();
  const base = { branchId, docType: 'sales_invoice', fy: '2026-27', prefix: 'SI/26-27/' };

  it('has the 21 document types from spec 02', () => {
    expect(DOC_TYPES).toHaveLength(21);
    expect(DOC_TYPES).toContain('sales_invoice');
    expect(DOC_TYPES).toContain('journal');
  });

  it('defaults padding 4, empty suffix and next number 1', () => {
    expect(documentSeriesCreateSchema.parse(base)).toEqual({
      ...base,
      suffix: '',
      padding: 4,
      nextNumber: '1',
      isDefault: false,
    });
  });

  it('rejects a series whose numbers would exceed 16 characters (GST rule 46)', () => {
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, suffix: '/ABCD' }))).toEqual([
      'padding',
    ]);
    expect(
      pathsOf(documentSeriesCreateSchema.safeParse({ ...base, nextNumber: '10000000' })),
    ).toEqual(['nextNumber']);
    expect(documentSeriesCreateSchema.safeParse({ ...base, nextNumber: '9999999' }).success).toBe(
      true,
    );
  });

  it('rejects disallowed characters, bad FY labels and non-positive numbers', () => {
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, prefix: 'SI 26' }))).toEqual([
      'prefix',
    ]);
    expect(documentSeriesCreateSchema.safeParse({ ...base, fy: '2026-28' }).success).toBe(false);
    expect(documentSeriesCreateSchema.safeParse({ ...base, nextNumber: '0' }).success).toBe(false);
    expect(documentSeriesCreateSchema.safeParse({ ...base, docType: 'invoice' }).success).toBe(
      false,
    );
  });

  it('update checks the full width only when prefix, suffix and padding are all sent', () => {
    expect(documentSeriesUpdateSchema.parse({ nextNumber: '42', version: 3 })).toEqual({
      nextNumber: '42',
      version: 3,
    });
    expect(
      pathsOf(
        documentSeriesUpdateSchema.safeParse({
          prefix: 'ABCDEFGHIJ',
          suffix: '',
          padding: 8,
          version: 1,
        }),
      ),
    ).toEqual(['padding']);
    expect(documentSeriesUpdateSchema.safeParse({ prefix: 'SI 26', version: 1 }).success).toBe(
      false,
    );
  });

  it('filters lists by branch, document type and FY', () => {
    expect(
      documentSeriesListQuerySchema.parse({ branchId, docType: 'grn', fy: '2026-27' }),
    ).toMatchObject({ branchId, docType: 'grn', fy: '2026-27' });
  });
});
