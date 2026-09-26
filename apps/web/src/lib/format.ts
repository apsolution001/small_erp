import { formatINR, formatQty as fixQty, Money } from '@ekaro/core';

/**
 * Display formatting (frontend standard): Indian digit grouping (`12,34,567.00`) and dates as
 * `dd-MMM-yyyy` (`26-Sep-2026`), the way Indian accountants read them. No float arithmetic:
 * money goes through `Money`, quantities through the core Decimal.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** India is UTC+05:30 all year; an instant belongs to the Indian calendar day. */
const IST_OFFSET_MS = 330 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const indianInteger = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export interface FormatMoneyOptions {
  /** Prefix `₹` (default true). Dense table columns turn it off. */
  readonly symbol?: boolean;
}

/** `"123456750"` paise (or a Money) → `₹12,34,567.50`. */
export function formatMoney(value: Money | string, options: FormatMoneyOptions = {}): string {
  const money = typeof value === 'string' ? Money.parse(value) : value;
  return formatINR(money, options);
}

/** A quantity string with exactly `decimals` places (half up) and Indian grouping. */
export function formatQty(value: string, decimals: number): string {
  const fixed = fixQty(value, decimals);
  const negative = fixed.startsWith('-');
  const [whole = '0', fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = indianInteger.format(BigInt(whole));
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

function calendarDay(value: string | Date): CalendarDay {
  if (typeof value === 'string') {
    const match = DATE_ONLY.exec(value);
    if (match) {
      // A calendar date (`date` column) is shown as is: no time zone shift.
      return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    }
  }
  const time = typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (Number.isNaN(time)) throw new RangeError(`Invalid date "${String(value)}"`);
  const ist = new Date(time + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

/** `2026-09-26` or an instant → `26-Sep-2026` (instants are read in IST). */
export function formatDate(value: string | Date): string {
  const { year, month, day } = calendarDay(value);
  const name = MONTHS[month - 1];
  if (name === undefined) throw new RangeError(`Invalid date "${String(value)}"`);
  return `${String(day).padStart(2, '0')}-${name}-${String(year)}`;
}
