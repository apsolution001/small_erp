/**
 * GST Unit Quantity Codes (the GSTN UQC master used by GSTR-1 HSN summaries and e-invoices).
 * Tenant units map onto one of these codes.
 */
// prettier-ignore
export const UQC_CODES = [
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM',
  'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS',
  'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS',
  'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD',
  'TON', 'TUB', 'UGS', 'UNT', 'YDS',
] as const;

export type UqcCode = (typeof UQC_CODES)[number];

export interface Uqc {
  readonly code: UqcCode;
  readonly description: string;
}

const DESCRIPTIONS: Readonly<Record<UqcCode, string>> = {
  BAG: 'Bags',
  BAL: 'Bale',
  BDL: 'Bundles',
  BKL: 'Buckles',
  BOU: 'Billion of units',
  BOX: 'Box',
  BTL: 'Bottles',
  BUN: 'Bunches',
  CAN: 'Cans',
  CBM: 'Cubic meters',
  CCM: 'Cubic centimeters',
  CMS: 'Centimeters',
  CTN: 'Cartons',
  DOZ: 'Dozens',
  DRM: 'Drums',
  GGK: 'Great gross',
  GMS: 'Grammes',
  GRS: 'Gross',
  GYD: 'Gross yards',
  KGS: 'Kilograms',
  KLR: 'Kilolitre',
  KME: 'Kilometre',
  LTR: 'Litres',
  MLT: 'Millilitre',
  MTR: 'Meters',
  MTS: 'Metric ton',
  NOS: 'Numbers',
  OTH: 'Others',
  PAC: 'Packs',
  PCS: 'Pieces',
  PRS: 'Pairs',
  QTL: 'Quintal',
  ROL: 'Rolls',
  SET: 'Sets',
  SQF: 'Square feet',
  SQM: 'Square meters',
  SQY: 'Square yards',
  TBS: 'Tablets',
  TGM: 'Ten gross',
  THD: 'Thousands',
  TON: 'Tonnes',
  TUB: 'Tubes',
  UGS: 'US gallons',
  UNT: 'Units',
  YDS: 'Yards',
};

export const UQCS: readonly Uqc[] = Object.freeze(
  UQC_CODES.map((code) => ({ code, description: DESCRIPTIONS[code] })),
);

const CODES: ReadonlySet<string> = new Set(UQC_CODES);

export function isValidUqc(code: string): code is UqcCode {
  return CODES.has(code);
}
