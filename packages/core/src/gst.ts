import { type DecimalLike, toDecimal } from './decimal.js';
import { Money } from './money.js';
import { isCurrentStateCode, isValidPlaceOfSupply } from './states.js';

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

export interface SplitTaxOptions {
  /** Total GST rate in percent (0–100), from the `tax_rates` master. */
  readonly rate: DecimalLike;
  /** Ad-valorem compensation cess in percent (default 0). */
  readonly cess?: DecimalLike;
  readonly supplyType: SupplyType;
}

/**
 * Computes GST on one line's taxable value (line-level rounding, accounting standard).
 *
 * Intra-state: CGST and SGST are each `round_half_up(taxable × rate/2 %)`. Because the halves are
 * rounded separately, CGST + SGST can legitimately differ by 1 paise from `round(taxable × rate %)`
 * (₹1.01 at 5% gives 3 + 3 paise, not 5). This matches how the halves are reported and posted to
 * separate ledgers. Inter-state: IGST is `round_half_up(taxable × rate %)`.
 * `sgst` also carries UTGST for union territories without a legislature (see `IndianState.levy`).
 *
 * Cess is **ad valorem only**: a percentage of the taxable value. Specific (per-unit) and
 * compound compensation cess are out of V1 scope (accounting standard).
 *
 * Rates come from the `tax_rates` master; nothing here hard-codes a slab.
 */
export function splitTax(taxable: Money, options: SplitTaxOptions): TaxSplit {
  const rate = toDecimal(options.rate);
  const cessRate = toDecimal(options.cess ?? '0');
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new RangeError(`GST rate must be between 0 and 100, got ${rate.toString()}`);
  }
  if (cessRate.isNegative()) {
    throw new RangeError(`Cess rate must not be negative, got ${cessRate.toString()}`);
  }
  const cess = taxable.multiply(cessRate.dividedBy(100));
  if (options.supplyType === 'intra') {
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

/** Place-of-supply code for supplies outside India (exports). */
const OTHER_COUNTRIES = '96';

/**
 * Place of supply decides the tax type: same state → intra (CGST + SGST), else inter (IGST).
 * The supplier state must be a current GST state code. The place of supply may also be `96`
 * (Other Countries, always inter-state) or `99` (Centre Jurisdiction). The legacy codes 25 and
 * 28 are rejected on both sides: their registrations moved to 26 and 37.
 */
export function supplyTypeFor(
  supplierState: string,
  placeOfSupply: string,
  options: SupplyTypeOptions = {},
): SupplyType {
  if (!isCurrentStateCode(supplierState)) {
    throw new RangeError(`Unknown or legacy GST state code "${supplierState}"`);
  }
  if (!isValidPlaceOfSupply(placeOfSupply)) {
    throw new RangeError(`Unknown or legacy place-of-supply code "${placeOfSupply}"`);
  }
  if (options.zeroRated === true || placeOfSupply === OTHER_COUNTRIES) return 'inter';
  return supplierState === placeOfSupply ? 'intra' : 'inter';
}
