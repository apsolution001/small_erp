import { DOC_TYPES } from '@ekaro/contracts';
import { DOC_NUMBER_MAX_LENGTH } from '@ekaro/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList } from '../../../infra/db/checks.js';
import { tenantTable } from '../../../infra/db/columns.js';
import { branches } from '../branches/branches.schema.js';

/**
 * Numbering series per branch, document type and FY (spec 02 §2, ADR 0010). Numbers are allocated
 * at post time with `SELECT ... FOR UPDATE` (Sprint 2). The rendered number must fit GST rule 46:
 * at most 16 characters of `[A-Za-z0-9/-]`, checked here as well as in `@ekaro/core`.
 */
export const documentSeries = tenantTable(
  'document_series',
  {
    branchId: uuid().notNull(),
    docType: text({ enum: DOC_TYPES }).notNull(),
    fy: text().notNull(),
    prefix: text().notNull(),
    suffix: text().notNull().default(''),
    padding: smallint().notNull().default(4),
    nextNumber: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`1`),
    /**
     * The last number issued; null while the series has issued nothing. Set only by number
     * allocation (Sprint 2). Once set, the numbering fields are fixed (a trigger enforces it).
     */
    lastIssuedNumber: bigint({ mode: 'bigint' }),
    isDefault: boolean().notNull().default(false),
  },
  (t) => [
    unique('document_series_tenant_key_unique').on(
      t.tenantId,
      t.branchId,
      t.docType,
      t.fy,
      t.prefix,
      t.suffix,
    ),
    uniqueIndex('document_series_one_default')
      .on(t.tenantId, t.branchId, t.docType, t.fy)
      .where(sql`${t.isDefault}`),
    foreignKey({
      name: 'document_series_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }),
    index('document_series_tenant_branch_idx').on(t.tenantId, t.branchId),
    check('document_series_doc_type_valid', inList(t.docType, DOC_TYPES)),
    check(
      'document_series_fy_format',
      sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$' and right(${t.fy}, 2)::int = (left(${t.fy}, 4)::int + 1) % 100`,
    ),
    // Upper-cased on input (contracts), so numbers are unique case-insensitively; a prefix starts
    // with a letter or 1-9 (e-invoice: a document number never starts with 0 or a symbol).
    check(
      'document_series_affix_format',
      sql`${t.prefix} ~ '^([A-Z1-9][A-Z0-9/-]{0,9})?$' and ${t.suffix} ~ '^[A-Z0-9/-]{0,6}$'`,
    ),
    check('document_series_padding_range', sql`${t.padding} between 1 and 8`),
    check('document_series_next_number_positive', sql`${t.nextNumber} >= 1`),
    // Numbers are gapless: after issuing n, the next number is n + 1.
    check(
      'document_series_next_follows_last_issued',
      sql`${t.lastIssuedNumber} is null or (${t.lastIssuedNumber} >= 1 and ${t.nextNumber} = ${t.lastIssuedNumber} + 1)`,
    ),
    check(
      'document_series_number_length',
      sql`char_length(${t.prefix}) + greatest(${t.padding}, char_length(${t.nextNumber}::text)) + char_length(${t.suffix}) <= ${sql.raw(String(DOC_NUMBER_MAX_LENGTH))}`,
    ),
  ],
);

export type DocumentSeriesRow = typeof documentSeries.$inferSelect;
export type NewDocumentSeriesRow = typeof documentSeries.$inferInsert;
