import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { sql } from 'drizzle-orm';
import { type AppDb, type AppTransactionalAdapter } from '../../../infra/db/app-db.js';
import { type RowChanges } from '../../../infra/db/record-meta.js';
import {
  companyProfile,
  type CompanyProfileRow,
  type NewCompanyProfileRow,
} from './company-profile.schema.js';

/** The columns `PATCH /company` may write. */
export type CompanyChanges = RowChanges<
  NewCompanyProfileRow,
  | 'legalName'
  | 'tradeName'
  | 'gstin'
  | 'pan'
  | 'line1'
  | 'line2'
  | 'city'
  | 'pincode'
  | 'stateCode'
  | 'email'
  | 'phone'
  | 'booksBeginDate'
  | 'valuationMethod'
  | 'allowNegativeStock'
  | 'roundOffSales'
  | 'hsnMinDigits'
  | 'eInvoiceEnabled'
>;

/**
 * The tenant's single `company_profile` row. RLS limits every query to the tenant in context, so
 * "the" row needs no key.
 */
@Injectable()
export class CompanyRepository {
  constructor(private readonly txHost: TransactionHost<AppTransactionalAdapter>) {}

  private get db(): AppDb {
    return this.txHost.tx;
  }

  async find(options: { forUpdate?: boolean } = {}): Promise<CompanyProfileRow | undefined> {
    const query = this.db.select().from(companyProfile);
    const [row] = options.forUpdate === true ? await query.for('update') : await query;
    return row;
  }

  async update(changes: CompanyChanges): Promise<CompanyProfileRow> {
    const [row] = await this.db
      .update(companyProfile)
      .set({ ...changes, version: sql`${companyProfile.version} + 1` })
      .returning();
    if (row === undefined) throw new Error('The company profile vanished during its update');
    return row;
  }
}
