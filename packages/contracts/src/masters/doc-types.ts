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
