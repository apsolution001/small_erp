import { type DecimalLike, toDecimal } from './decimal.js';
import { Money } from './money.js';
import { isValidStateCode } from './states.js';

/** `intra`: CGST + SGST/UTGST. `inter`: IGST. */
export type SupplyType = 'intra' | 'inter';

export interface TaxSplit {
  readonly cgst: Money;
  readonly sgst: Money;
  readonly igst: Money;
  readonly cess: Money;
  /** cgst + sgst + igst + cess. */
  readonly total: Money;
}

/**
 * Computes GST on one line's taxable value (line-level rounding, accounting standard).
 *
 * Intra-state: CGST and SGST are each `round_half_up(taxable × rate/2 %)`. Because the halves are
 * rounded separately, CGST + SGST can legitimately differ by 1 paise from `round(taxable × rate %)`
 * (₹1.01 at 5% gives 3 + 3 paise, not 5). This matches how the halves are reported and posted to
 * separate ledgers. Inter-state: IGST is `round_half_up(taxable × rate %)`.
 * `sgst` also carries UTGST for union territories without a legislature (see `IndianState.levy`).
 * Cess is always computed on the taxable value (ad valorem).
 *
 * Rates come from the `tax_rates` master; nothing here hard-codes a slab.
 */
export function splitTax(
  taxable: Money,
  ratePct: DecimalLike,
  cessPct: DecimalLike,
  supplyType: SupplyType,
): TaxSplit {
  const rate = toDecimal(ratePct);
  const cessRate = toDecimal(cessPct);
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new RangeError(`GST rate must be between 0 and 100, got ${rate.toString()}`);
  }
  if (cessRate.isNegative()) {
    throw new RangeError(`Cess rate must not be negative, got ${cessRate.toString()}`);
  }
  const cess = taxable.multiply(cessRate.dividedBy(100));
  if (supplyType === 'intra') {
    const half = taxable.multiply(rate.dividedBy(200));
    return { cgst: half, sgst: half, igst: Money.ZERO, cess, total: Money.sum([half, half, cess]) };
  }
  const igst = taxable.multiply(rate.dividedBy(100));
  return { cgst: Money.ZERO, sgst: Money.ZERO, igst, cess, total: igst.add(cess) };
}

export interface SupplyTypeOptions {
  /**
   * Zero-rated supplies (to an SEZ unit or developer, or exports) are inter-state supplies
   * whatever the states are (IGST Act s. 7(5), s. 16).
   */
  readonly zeroRated?: boolean;
}

/** Place of supply decides the tax type: same state → intra (CGST + SGST), else inter (IGST). */
export function supplyTypeFor(
  supplierState: string,
  placeOfSupplyState: string,
  options: SupplyTypeOptions = {},
): SupplyType {
  for (const code of [supplierState, placeOfSupplyState]) {
    if (!isValidStateCode(code)) {
      throw new RangeError(`Unknown GST state code "${code}"`);
    }
  }
  if (options.zeroRated === true) return 'inter';
  return supplierState === placeOfSupplyState ? 'intra' : 'inter';
}
