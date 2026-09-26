import { type ValuationMethod } from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { CompanyRepository } from './company.repository.js';
import { type CompanyProfileRow } from './company-profile.schema.js';

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

/** The tenant's company profile (spec 02 §2–3). */
@Injectable()
export class CompanyService {
  constructor(private readonly company: CompanyRepository) {}

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
