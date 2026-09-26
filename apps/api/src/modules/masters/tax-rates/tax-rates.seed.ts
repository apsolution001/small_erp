import { type NewTaxRateRow } from './tax-rates.schema.js';

type Slab = Pick<NewTaxRateRow, 'name' | 'gstRate' | 'isExempt' | 'isNilRated' | 'isActive'>;

const rate = (gstRate: string, isActive = true): Slab => ({
  name: `GST ${gstRate}%`,
  gstRate,
  isExempt: false,
  isNilRated: false,
  isActive,
});

/**
 * GST slabs seeded into every tenant (spec 02 §2 and §4): nil-rated, exempt, and the current
 * rates. 12% and 28% were folded into 5%/18%/40% (GST 2.0) and stay, inactive, for back-dated
 * documents. No cess slabs: cess is item-specific and added by the tenant.
 */
export const DEFAULT_TAX_RATES: readonly Slab[] = [
  { name: 'Nil Rated', gstRate: '0', isExempt: false, isNilRated: true, isActive: true },
  { name: 'Exempt', gstRate: '0', isExempt: true, isNilRated: false, isActive: true },
  rate('0.25'),
  rate('1.5'),
  rate('3'),
  rate('5'),
  rate('18'),
  rate('40'),
  rate('12', false),
  rate('28', false),
];

export function buildDefaultTaxRates(): NewTaxRateRow[] {
  return DEFAULT_TAX_RATES.map((slab) => ({ ...slab, cessRate: '0', isNonGst: false }));
}
