/**
 * Indian financial year helpers. The FY runs 1 April – 31 March and is labelled `YYYY-YY`
 * (`2026-27`). Dates are plain calendar dates (`YYYY-MM-DD`, as stored in `date` columns).
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LABEL_PATTERN = /^(\d{4})-(\d{2})$/;
/** India has a single time zone with no daylight saving: UTC+05:30. */
const IST_OFFSET_MS = 330 * 60 * 1000;

export interface FyRange {
  /** First day, e.g. `2026-04-01`. */
  readonly start: string;
  /** Last day, e.g. `2027-03-31`. */
  readonly end: string;
}

function labelFor(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function calendarDate(date: Date | string): { year: number; month: number } {
  if (typeof date !== 'string') {
    const time = date.getTime();
    if (Number.isNaN(time)) throw new RangeError('Invalid Date');
    // A Date is an instant; the business day it belongs to is the Indian calendar day.
    const ist = new Date(time + IST_OFFSET_MS);
    return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
  }
  const match = DATE_PATTERN.exec(date);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Invalid date "${date}": expected YYYY-MM-DD`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError(`Invalid date "${date}": no such calendar day`);
  }
  return { year, month };
}

/** The FY label of a date: `fyOf('2026-09-26') → '2026-27'`. A Date is read in IST. */
export function fyOf(date: Date | string): string {
  const { year, month } = calendarDate(date);
  return labelFor(month >= 4 ? year : year - 1);
}

export function isValidFyLabel(label: string): boolean {
  const match = LABEL_PATTERN.exec(label);
  return match !== null && labelFor(Number(match[1])) === label;
}

function startYearOf(label: string): number {
  if (!isValidFyLabel(label)) {
    throw new RangeError(`Invalid financial year "${label}": expected e.g. 2026-27`);
  }
  return Number(label.slice(0, 4));
}

/** `fyRange('2026-27') → { start: '2026-04-01', end: '2027-03-31' }`. */
export function fyRange(label: string): FyRange {
  const startYear = startYearOf(label);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** `fyShort('2026-27') → '26-27'`, as used in document prefixes like `SI/26-27/`. */
export function fyShort(label: string): string {
  startYearOf(label);
  return label.slice(2);
}

/** The FY of `now` (pass a fixed clock in tests). */
export function currentFy(now: Date = new Date()): string {
  return fyOf(now);
}
