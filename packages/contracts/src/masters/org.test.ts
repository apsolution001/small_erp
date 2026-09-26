import { uuidv7 } from '@ekaro/core';
import { describe, expect, it } from 'vitest';
import { pathsOf, unrecognizedKeysOf } from '../testing/paths.js';
import {
  branchCreateSchema,
  branchListQuerySchema,
  branchRecordSchema,
  branchResponseSchema,
  branchUpdateSchema,
} from './branch.js';
import {
  companyCreateSchema,
  companyRecordSchema,
  companyResponseSchema,
  companyUpdateSchema,
} from './company.js';
import { DOC_TYPES, docNumberFamily } from './doc-types.js';
import {
  documentSeriesCreateSchema,
  documentSeriesListQuerySchema,
  documentSeriesRecordSchema,
  documentSeriesResponseSchema,
  documentSeriesUpdateSchema,
} from './document-series.js';
import {
  godownCreateSchema,
  godownRecordSchema,
  godownListQuerySchema,
  godownResponseSchema,
  godownUpdateSchema,
} from './godown.js';

const address = { line1: '12 MG Road', city: 'Pune', pincode: '411001', stateCode: '27' };
const meta = {
  id: uuidv7(),
  version: 4,
  createdAt: '2026-04-01T04:30:00.000Z',
  updatedAt: '2026-09-26T10:15:00.123Z',
};

describe('company schemas', () => {
  const company = {
    legalName: 'Acme Traders LLP',
    gstin: '27AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
    ...address,
    booksBeginDate: '2026-04-01',
  };
  const stored = {
    ...company,
    tradeName: null,
    line2: null,
    email: null,
    phone: null,
    valuationMethod: 'weighted_average' as const,
    allowNegativeStock: false,
    roundOffSales: true,
    hsnMinDigits: 4 as const,
    eInvoiceEnabled: false,
  };

  it('applies the spec 02 defaults on create', () => {
    expect(companyCreateSchema.parse(company)).toEqual(stored);
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
    expect(pathsOf(companyCreateSchema.safeParse({ ...company, hsnMinDigits: 8 }))).toEqual([
      'hsnMinDigits',
    ]);
  });

  it('rejects the legacy state codes 25 and 28', () => {
    for (const stateCode of ['25', '28']) {
      expect(
        pathsOf(companyCreateSchema.safeParse({ ...company, gstin: null, pan: null, stateCode })),
        stateCode,
      ).toEqual(['stateCode']);
    }
  });

  it('create is strict', () => {
    expect(
      unrecognizedKeysOf(companyCreateSchema.safeParse({ ...company, tenantId: 'x' })),
    ).toEqual(['tenantId']);
  });

  it('updates partially without applying create defaults', () => {
    expect(companyUpdateSchema.parse({ roundOffSales: false, version: 4 })).toEqual({
      roundOffSales: false,
      version: 4,
    });
    expect(companyUpdateSchema.parse({ legalName: 'Acme LLP', version: 4 })).toEqual({
      legalName: 'Acme LLP',
      version: 4,
    });
    expect(pathsOf(companyUpdateSchema.safeParse({ version: 4 }))).toEqual(['']);
    expect(
      unrecognizedKeysOf(companyUpdateSchema.safeParse({ logoObjectKey: 'x', version: 4 })),
    ).toEqual(['logoObjectKey']);
  });

  it('rejects a patch that is valid alone but breaks GSTIN vs state once merged', () => {
    const existing = { ...stored, logoObjectKey: null, ...meta };
    const patch = { stateCode: '29', version: 4 };
    expect(companyUpdateSchema.safeParse(patch).success).toBe(true);
    expect(companyRecordSchema.safeParse(existing).success).toBe(true);
    expect(pathsOf(companyRecordSchema.safeParse({ ...existing, ...patch }))).toEqual(['gstin']);
  });

  it('parses a DB-shaped company row', () => {
    const row = {
      ...stored,
      legalName: 'ACME TRADERS LLP', // as the GSTN lookup returned it
      tradeName: 'Acme',
      email: 'accounts@acme.in',
      phone: '02024567890', // stored before the E.164 rule
      hsnMinDigits: 6,
      logoObjectKey: 'tenants/1/logo.png',
      version: 1,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    expect(companyResponseSchema.parse(row)).toEqual(row);
  });
});

describe('branch schemas', () => {
  const branch = { code: 'HO', name: 'Head office', ...address };

  it('defaults gstin, head-office and active flags', () => {
    expect(branchCreateSchema.parse(branch)).toEqual({
      ...branch,
      gstin: null,
      line2: null,
      isHeadOffice: false,
      isActive: true,
    });
  });

  it('a branch GSTIN must be registered in the branch state', () => {
    const karnataka = { ...branch, code: 'BLR', stateCode: '29' };
    expect(branchCreateSchema.safeParse({ ...karnataka, gstin: '29AAGCB7383J1Z4' }).success).toBe(
      true,
    );
    expect(
      pathsOf(branchCreateSchema.safeParse({ ...karnataka, gstin: '27AAPFU0939F1ZV' })),
    ).toEqual(['gstin']);
  });

  it('limits the code to 10 characters', () => {
    expect(pathsOf(branchCreateSchema.safeParse({ ...branch, code: 'ABCDEFGHIJK' }))).toEqual([
      'code',
    ]);
  });

  it('updates with a version, without create defaults, and rejects immutable keys', () => {
    expect(branchUpdateSchema.parse({ isActive: false, version: 2 })).toEqual({
      isActive: false,
      version: 2,
    });
    expect(branchUpdateSchema.parse({ name: 'Pune HO', version: 2 })).toEqual({
      name: 'Pune HO',
      version: 2,
    });
    expect(pathsOf(branchUpdateSchema.safeParse({ version: 2 }))).toEqual(['']);
    expect(unrecognizedKeysOf(branchUpdateSchema.safeParse({ id: meta.id, version: 2 }))).toEqual([
      'id',
    ]);
  });

  it('rejects a patch that is valid alone but breaks GSTIN vs state once merged', () => {
    const existing = {
      ...meta,
      ...branch,
      gstin: '27AAPFU0939F1ZV',
      line2: null,
      isHeadOffice: true,
      isActive: true,
    };
    const patch = { stateCode: '29', version: 4 };
    expect(branchUpdateSchema.safeParse(patch).success).toBe(true);
    expect(pathsOf(branchRecordSchema.safeParse({ ...existing, ...patch }))).toEqual(['gstin']);
    expect(branchRecordSchema.safeParse({ ...existing, name: 'Pune' }).success).toBe(true);
  });

  it('filters lists by active and sorts on allowed columns only', () => {
    expect(branchListQuerySchema.parse({ active: 'false', sort: 'code:asc' })).toMatchObject({
      active: false,
      sort: 'code:asc',
    });
    expect(pathsOf(branchListQuerySchema.safeParse({ sort: 'gstin:asc' }))).toEqual(['sort']);
    expect(unrecognizedKeysOf(branchListQuerySchema.safeParse({ tenantId: 'x' }))).toEqual([
      'tenantId',
    ]);
  });

  it('parses a DB-shaped branch row', () => {
    const row = {
      ...meta,
      code: 'ho',
      name: 'Head office',
      gstin: '27AAPFU0939F1ZV',
      line1: '12 MG Road',
      line2: null,
      city: 'Pune',
      pincode: '411001',
      stateCode: '27',
      isHeadOffice: true,
      isActive: true,
    };
    expect(branchResponseSchema.parse(row)).toEqual(row);
  });
});

describe('godown schemas', () => {
  const branchId = uuidv7();

  it('belongs to a branch and blocks negative stock by default', () => {
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

  it('updates without create defaults and is strict', () => {
    expect(godownUpdateSchema.parse({ name: 'Main store', version: 1 })).toEqual({
      name: 'Main store',
      version: 1,
    });
    expect(pathsOf(godownUpdateSchema.safeParse({ version: 1 }))).toEqual(['']);
    expect(
      unrecognizedKeysOf(godownCreateSchema.safeParse({ branchId, code: 'M', name: 'M', x: 1 })),
    ).toEqual(['x']);
  });

  it('sorts on allowed columns only', () => {
    expect(pathsOf(godownListQuerySchema.safeParse({ sort: 'address:asc' }))).toEqual(['sort']);
  });

  it('the record schema checks a merged godown and strips the stored metadata', () => {
    const stored = { ...meta, branchId, code: 'MAIN', name: 'Main', address: null };
    const merged = { ...stored, allowNegativeStock: false, isActive: true, name: 'Main store' };
    expect(godownRecordSchema.parse(merged)).toEqual({
      branchId,
      code: 'MAIN',
      name: 'Main store',
      address: null,
      allowNegativeStock: false,
      isActive: true,
    });
    expect(pathsOf(godownRecordSchema.safeParse({ ...merged, code: '' }))).toEqual(['code']);
  });

  it('parses a DB-shaped godown row', () => {
    const row = {
      ...meta,
      branchId,
      code: 'MAIN',
      name: 'Main',
      address: null,
      allowNegativeStock: false,
      isActive: true,
    };
    expect(godownResponseSchema.parse(row)).toEqual(row);
  });
});

describe('document series schemas', () => {
  const branchId = uuidv7();
  const base = { branchId, docType: 'sales_invoice', fy: '2026-27', prefix: 'SI/26-27/' };
  const existing = {
    ...meta,
    ...base,
    suffix: '',
    padding: 4,
    nextNumber: '1',
    isDefault: true,
  };

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

  it('upper-cases the prefix and suffix', () => {
    expect(
      documentSeriesCreateSchema.parse({ ...base, prefix: 'si/26-27/', suffix: '/a' }),
    ).toMatchObject({ prefix: 'SI/26-27/', suffix: '/A' });
    expect(documentSeriesUpdateSchema.parse({ prefix: 'inv-', version: 1 })).toEqual({
      prefix: 'INV-',
      version: 1,
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

  it('requires the first rendered character to be a letter or 1-9 (e-invoice)', () => {
    for (const prefix of ['/SI', '-SI', '0SI']) {
      expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, prefix })), prefix).toEqual([
        'prefix',
      ]);
    }
    // No prefix: padding 4 would render 0001.
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, prefix: '' }))).toEqual([
      'padding',
    ]);
    expect(documentSeriesCreateSchema.safeParse({ ...base, prefix: '', padding: 1 }).success).toBe(
      true,
    );
  });

  it('rejects disallowed characters, bad FY labels, non-positive numbers and unknown types', () => {
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, prefix: 'SI 26' }))).toEqual([
      'prefix',
    ]);
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, fy: '2026-28' }))).toEqual([
      'fy',
    ]);
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, nextNumber: '0' }))).toEqual([
      'nextNumber',
    ]);
    expect(pathsOf(documentSeriesCreateSchema.safeParse({ ...base, docType: 'invoice' }))).toEqual([
      'docType',
    ]);
  });

  it('update is strict: branch, document type and FY cannot change', () => {
    const patch = { fy: '2027-28', docType: 'grn', branchId, nextNumber: '5', version: 3 };
    expect(unrecognizedKeysOf(documentSeriesUpdateSchema.safeParse(patch))).toEqual([
      'fy',
      'docType',
      'branchId',
    ]);
  });

  it('update applies no create defaults and needs a field to change', () => {
    expect(documentSeriesUpdateSchema.parse({ nextNumber: '42', version: 3 })).toEqual({
      nextNumber: '42',
      version: 3,
    });
    expect(pathsOf(documentSeriesUpdateSchema.safeParse({ version: 3 }))).toEqual(['']);
  });

  it('rejects a patch that is valid alone but too wide once merged', () => {
    const wide = { ...existing, prefix: 'ABCDEFGHIJ' };
    const patch = { padding: 8, version: 4 };
    expect(documentSeriesUpdateSchema.safeParse(patch).success).toBe(true);
    expect(documentSeriesRecordSchema.safeParse(wide).success).toBe(true);
    expect(pathsOf(documentSeriesRecordSchema.safeParse({ ...wide, ...patch }))).toEqual([
      'padding',
    ]);
    expect(
      pathsOf(documentSeriesRecordSchema.safeParse({ ...existing, nextNumber: '10000000' })),
    ).toEqual(['nextNumber']);
    expect(
      pathsOf(documentSeriesRecordSchema.safeParse({ ...existing, prefix: '', padding: 4 })),
    ).toEqual(['padding']);
  });

  it('filters lists by branch, document type and FY, and sorts on allowed columns', () => {
    expect(
      documentSeriesListQuerySchema.parse({
        branchId,
        docType: 'grn',
        fy: '2026-27',
        sort: 'fy:desc',
      }),
    ).toMatchObject({ branchId, docType: 'grn', fy: '2026-27', sort: 'fy:desc' });
    expect(pathsOf(documentSeriesListQuerySchema.safeParse({ sort: 'nextNumber:asc' }))).toEqual([
      'sort',
    ]);
  });

  it('parses a DB-shaped series row, with or without issued numbers', () => {
    const row = { ...existing, nextNumber: '9223372036854775807', lastIssuedNumber: null };
    expect(documentSeriesResponseSchema.parse(row)).toEqual(row);
    const issued = { ...existing, nextNumber: '43', lastIssuedNumber: '42' };
    expect(documentSeriesResponseSchema.parse(issued)).toEqual(issued);
  });

  it('groups document types into GSTR-1 numbering families', () => {
    expect(docNumberFamily('sales_invoice')).toBe('invoice');
    expect(docNumberFamily('credit_note')).toBe(docNumberFamily('debit_note'));
    expect(docNumberFamily('delivery_challan')).toBe('delivery_challan');
    expect(new Set(DOC_TYPES.map(docNumberFamily)).size).toBe(DOC_TYPES.length - 1);
  });
});
