import { type DocType, type DocumentSeriesListQuery } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, count, eq, ilike, inArray, type SQL, sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { containsPattern, orderByOf, pageOffset } from '../../../infra/db/list-query.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import { lockTenantScope } from '../../../infra/db/tenant-lock.js';
import { branches } from '../branches/branches.schema.js';
import {
  documentSeries,
  type DocumentSeriesRow,
  type NewDocumentSeriesRow,
} from './document-series.schema.js';

/** The columns a PATCH may write: never the identity (branch, type, FY) nor the issued number. */
export type DocumentSeriesChanges = RowChanges<
  NewDocumentSeriesRow,
  'prefix' | 'suffix' | 'padding' | 'nextNumber' | 'isDefault'
>;

/** A series with the GSTIN of its branch, for the per-GSTIN number uniqueness rule. */
export interface SeriesWithBranchGstin extends DocumentSeriesRow {
  readonly branchGstin: string | null;
}

/** Drizzle queries on `document_series`, in the request's tenant transaction. */
@Injectable()
export class DocumentSeriesRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  /** Serialises series writes of the tenant: number overlap and defaults span rows. */
  lockSeries(): Promise<void> {
    return lockTenantScope(this.db, 'document_series');
  }

  async list(
    query: DocumentSeriesListQuery,
  ): Promise<{ rows: DocumentSeriesRow[]; total: number }> {
    const where = and(...filtersOf(query));
    const rows = await this.db
      .select()
      .from(documentSeries)
      .where(where)
      .orderBy(
        ...orderByOf(
          query.sort,
          'docType:asc',
          {
            docType: documentSeries.docType,
            fy: documentSeries.fy,
            prefix: documentSeries.prefix,
            createdAt: documentSeries.createdAt,
          },
          documentSeries.id,
        ),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize));
    const [totals] = await this.db.select({ total: count() }).from(documentSeries).where(where);
    return { rows, total: totals?.total ?? 0 };
  }

  async findById(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<DocumentSeriesRow | undefined> {
    const query = this.db.select().from(documentSeries).where(eq(documentSeries.id, id));
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  /** Every series of the FY among `docTypes`, with its branch's GSTIN. */
  async findInFamily(fy: string, docTypes: readonly DocType[]): Promise<SeriesWithBranchGstin[]> {
    const rows = await this.db
      .select({ series: documentSeries, branchGstin: branches.gstin })
      .from(documentSeries)
      .innerJoin(branches, eq(branches.id, documentSeries.branchId))
      .where(and(eq(documentSeries.fy, fy), inArray(documentSeries.docType, [...docTypes])));
    return rows.map((r) => ({ ...r.series, branchGstin: r.branchGstin }));
  }

  /** Clears the default of (branch, document type, FY) before another series takes it. */
  async clearDefault(branchId: string, docType: DocType, fy: string): Promise<void> {
    await this.db
      .update(documentSeries)
      .set({ isDefault: false, version: sql`${documentSeries.version} + 1` })
      .where(
        and(
          eq(documentSeries.branchId, branchId),
          eq(documentSeries.docType, docType),
          eq(documentSeries.fy, fy),
          eq(documentSeries.isDefault, true),
        ),
      );
  }

  async insert(values: NewDocumentSeriesRow): Promise<DocumentSeriesRow> {
    const [row] = await this.db.insert(documentSeries).values(values).returning();
    if (row === undefined) throw new Error('Document series insert returned no row');
    return row;
  }

  async update(id: string, changes: DocumentSeriesChanges): Promise<DocumentSeriesRow> {
    const [row] = await this.db
      .update(documentSeries)
      .set({ ...changes, version: sql`${documentSeries.version} + 1` })
      .where(eq(documentSeries.id, id))
      .returning();
    if (row === undefined) throw new Error(`Document series ${id} vanished during its update`);
    return row;
  }
}

function filtersOf(query: DocumentSeriesListQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.q !== undefined) filters.push(ilike(documentSeries.prefix, containsPattern(query.q)));
  if (query.branchId !== undefined) filters.push(eq(documentSeries.branchId, query.branchId));
  if (query.docType !== undefined) filters.push(eq(documentSeries.docType, query.docType));
  if (query.fy !== undefined) filters.push(eq(documentSeries.fy, query.fy));
  return filters;
}
