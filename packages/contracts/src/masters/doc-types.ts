import { z } from 'zod';

/** Transactional document types, each with its own numbering series (spec 02, ADR 0010). */
export const DOC_TYPES = [
  'purchase_requisition',
  'purchase_order',
  'grn',
  'purchase_invoice',
  'debit_note',
  'quotation',
  'sales_order',
  'delivery_challan',
  'sales_invoice',
  'credit_note',
  'stock_transfer',
  'stock_adjustment',
  'work_order',
  'material_issue',
  'production_entry',
  'job_work_out',
  'job_work_in',
  'payment',
  'receipt',
  'contra',
  'journal',
] as const;

export const docTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof docTypeSchema>;
/** Enum-style access: `DocType.sales_invoice`. */
export const DocType = docTypeSchema.enum;

/**
 * Document types that share one number space per GSTIN and FY (spec 02 §2): GSTR-1 reports tax
 * invoices together, and credit and debit notes together, and the e-invoice IRN is keyed on
 * GSTIN + type + number + FY. Every other type is its own family.
 */
const SHARED_NUMBER_FAMILIES: Readonly<Partial<Record<DocType, string>>> = {
  sales_invoice: 'invoice',
  credit_note: 'note',
  debit_note: 'note',
};

/** The numbering family of a document type (two series of one family must never collide). */
export function docNumberFamily(docType: DocType): string {
  return SHARED_NUMBER_FAMILIES[docType] ?? docType;
}
