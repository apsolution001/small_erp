import {
  companyRecordSchema,
  type CompanyResponse,
  type CompanyUpdate,
  type ValuationMethod,
} from '@ekaro/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import { ItemsRepository } from '../items/items.repository.js';
import { toCompanyResponse } from './company.mapper.js';
import { CompanyRepository } from './company.repository.js';
import { type CompanyProfileRow } from './company-profile.schema.js';
import { STOCK_POSTINGS, type StockPostingsPort } from './stock-postings.port.js';

/** The company settings other masters apply (spec 02 §2). */
export interface CompanySettings {
  readonly gstin: string | null;
  readonly pan: string | null;
  readonly stateCode: string;
  readonly booksBeginDate: string;
  readonly valuationMethod: ValuationMethod;
  /** 4 or 6: the minimum HSN/SAC length on items. */
  readonly hsnMinDigits: number;
}

/**
 * The tenant's company profile (spec 02 §2–3): one row, created by the signup bootstrap, read and
 * edited here. The valuation method and the books-begin date are locked once stock has been
 * posted (409 `VALUATION_METHOD_LOCKED` / `BOOKS_BEGIN_DATE_LOCKED`), asked of the posting engine
 * through {@link StockPostingsPort}.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly company: CompanyRepository,
    private readonly items: ItemsRepository,
    @Inject(STOCK_POSTINGS) private readonly stockPostings: StockPostingsPort,
  ) {}

  async get(): Promise<CompanyResponse> {
    return toCompanyResponse(await this.require());
  }

  async update(patch: CompanyUpdate): Promise<CompanyResponse> {
    const existing = await this.require({ forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    parseMergedRecord(companyRecordSchema, toCompanyResponse(existing), changes);
    const { valuationMethod, booksBeginDate } = changes;
    const valuationChanges =
      valuationMethod !== undefined && valuationMethod !== existing.valuationMethod;
    const booksChange =
      booksBeginDate !== undefined && booksBeginDate !== existing.booksBeginDate
        ? booksBeginDate
        : undefined;
    if (
      (valuationChanges || booksChange !== undefined) &&
      (await this.stockPostings.hasStockPostings())
    ) {
      throw valuationChanges
        ? new ConflictError(
            'VALUATION_METHOD_LOCKED',
            'Stock has been posted, so the valuation method can no longer change.',
          )
        : new ConflictError(
            'BOOKS_BEGIN_DATE_LOCKED',
            'Stock has been posted, so the books-begin date can no longer change.',
          );
    }
    const row = await this.company.update(changes);
    if (booksChange !== undefined && booksChange < existing.booksBeginDate) {
      await this.items.extendFirstRatesTo(booksChange);
    }
    return toCompanyResponse(row);
  }

  async settings(): Promise<CompanySettings> {
    const row = await this.require();
    return {
      gstin: row.gstin,
      pan: row.pan,
      stateCode: row.stateCode,
      booksBeginDate: row.booksBeginDate,
      valuationMethod: row.valuationMethod,
      hsnMinDigits: row.hsnMinDigits,
    };
  }

  private async require(options: { forUpdate?: boolean } = {}): Promise<CompanyProfileRow> {
    const row = await this.company.find(options);
    // Every tenant has its profile from the signup bootstrap; its absence is a broken invariant.
    if (row === undefined) throw new Error('The tenant has no company profile');
    return row;
  }
}
