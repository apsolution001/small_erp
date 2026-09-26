import { Injectable } from '@nestjs/common';

/**
 * What the masters need to know about stock postings (ADR 0017 §6): the valuation method and the
 * books-begin date are locked once any stock has been posted (spec 02 §2, accounting standard).
 * The posting engine (Sprint 2) owns that fact and binds its own implementation to
 * {@link STOCK_POSTINGS}.
 */
export interface StockPostingsPort {
  /** True once the tenant has at least one stock ledger entry. */
  hasStockPostings(): Promise<boolean>;
}

export const STOCK_POSTINGS = Symbol('STOCK_POSTINGS');

/** The binding until the posting engine exists: nothing can have been posted yet. */
@Injectable()
export class NoStockPostingsYet implements StockPostingsPort {
  hasStockPostings(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
