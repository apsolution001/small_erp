import { type UqcCode, UQCS } from '@ekaro/core';
import { type NewUnitRow } from './units.schema.js';

/**
 * Units seeded into every tenant (spec 02 §4), each with the same code as its GST UQC. Counted
 * units have no decimals; weights and volumes allow 3 (grams, millilitres), lengths and areas 2.
 */
export const DEFAULT_UNITS: readonly (readonly [UqcCode, number])[] = [
  ['NOS', 0],
  ['PCS', 0],
  ['KGS', 3],
  ['GMS', 2],
  ['TON', 3],
  ['MTR', 2],
  ['CMS', 2],
  ['LTR', 3],
  ['MLT', 2],
  ['BOX', 0],
  ['BAG', 0],
  ['SET', 0],
  ['PAC', 0],
  ['ROL', 0],
  ['SQM', 2],
  ['SQF', 2],
  ['DOZ', 0],
  ['OTH', 2],
];

const DESCRIPTION = new Map(UQCS.map((u) => [u.code, u.description]));

export function buildDefaultUnits(): NewUnitRow[] {
  return DEFAULT_UNITS.map(([uqc, decimalPlaces]) => ({
    code: uqc,
    name: DESCRIPTION.get(uqc) ?? uqc,
    uqc,
    decimalPlaces,
  }));
}
