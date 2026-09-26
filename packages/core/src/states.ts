/** GST state codes (the first two characters of a GSTIN and the place-of-supply code). */
// prettier-ignore
export const STATE_CODES = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '97',
] as const;

export type StateCode = (typeof STATE_CODES)[number];

export interface IndianState {
  readonly code: StateCode;
  readonly name: string;
  readonly kind: 'state' | 'union_territory' | 'other_territory';
  /**
   * The levy that pairs with CGST on an intra-state supply. Union territories without a
   * legislature (and "Other Territory") levy UTGST instead of SGST (UTGST Act 2017).
   */
  readonly levy: 'SGST' | 'UTGST';
  /** Codes kept only for old GSTINs and back-dated documents; hide them from pickers. */
  readonly legacy: boolean;
}

const state = (code: StateCode, name: string): IndianState => ({
  code,
  name,
  kind: 'state',
  levy: 'SGST',
  legacy: false,
});
const utWithLegislature = (code: StateCode, name: string): IndianState => ({
  ...state(code, name),
  kind: 'union_territory',
});
const ut = (code: StateCode, name: string, legacy = false): IndianState => ({
  code,
  name,
  kind: 'union_territory',
  levy: 'UTGST',
  legacy,
});

/** Indian states and union territories with their GST state codes. */
export const STATES: readonly IndianState[] = Object.freeze([
  utWithLegislature('01', 'Jammu and Kashmir'),
  state('02', 'Himachal Pradesh'),
  state('03', 'Punjab'),
  ut('04', 'Chandigarh'),
  state('05', 'Uttarakhand'),
  state('06', 'Haryana'),
  utWithLegislature('07', 'Delhi'),
  state('08', 'Rajasthan'),
  state('09', 'Uttar Pradesh'),
  state('10', 'Bihar'),
  state('11', 'Sikkim'),
  state('12', 'Arunachal Pradesh'),
  state('13', 'Nagaland'),
  state('14', 'Manipur'),
  state('15', 'Mizoram'),
  state('16', 'Tripura'),
  state('17', 'Meghalaya'),
  state('18', 'Assam'),
  state('19', 'West Bengal'),
  state('20', 'Jharkhand'),
  state('21', 'Odisha'),
  state('22', 'Chhattisgarh'),
  state('23', 'Madhya Pradesh'),
  state('24', 'Gujarat'),
  ut('25', 'Daman and Diu', true),
  ut('26', 'Dadra and Nagar Haveli and Daman and Diu'),
  state('27', 'Maharashtra'),
  { ...state('28', 'Andhra Pradesh (before reorganisation)'), legacy: true },
  state('29', 'Karnataka'),
  state('30', 'Goa'),
  ut('31', 'Lakshadweep'),
  state('32', 'Kerala'),
  state('33', 'Tamil Nadu'),
  utWithLegislature('34', 'Puducherry'),
  ut('35', 'Andaman and Nicobar Islands'),
  state('36', 'Telangana'),
  state('37', 'Andhra Pradesh'),
  ut('38', 'Ladakh'),
  { ...ut('97', 'Other Territory'), kind: 'other_territory' },
]);

const BY_CODE: ReadonlyMap<string, IndianState> = new Map(STATES.map((s) => [s.code, s]));

export function isValidStateCode(code: string): code is StateCode {
  return BY_CODE.has(code);
}

export function getState(code: string): IndianState | undefined {
  return BY_CODE.get(code);
}
