/**
 * Document numbering series (MS-05, ADR 0010). GST rule 46 requires invoice numbers of at most
 * 16 characters using only letters, digits, `-` and `/`. The e-invoice schema also requires the
 * first character to be a letter or a digit 1–9 (never `0`, `/` or `-`).
 */

export const DOC_NUMBER_MAX_LENGTH = 16;
export const SERIES_PREFIX_MAX_LENGTH = 10;
export const SERIES_SUFFIX_MAX_LENGTH = 6;
export const SERIES_PADDING_MIN = 1;
export const SERIES_PADDING_MAX = 8;
/** Characters allowed in a prefix or suffix (and so in the rendered number). */
export const SERIES_CHARSET_PATTERN = /^[A-Za-z0-9/-]*$/;
/** The first character of a rendered document number (e-invoice `Doc No` pattern). */
export const DOC_NUMBER_FIRST_CHAR_PATTERN = /^[A-Za-z1-9]/;

export interface SeriesFormat {
  readonly prefix: string;
  readonly suffix: string;
  /** Minimum digits; the number is left-padded with zeros. */
  readonly padding: number;
}

export interface SeriesInput extends SeriesFormat {
  readonly nextNumber?: bigint | number;
}

export type SeriesIssueCode =
  | 'PREFIX_TOO_LONG'
  | 'SUFFIX_TOO_LONG'
  | 'INVALID_CHARACTERS'
  | 'INVALID_FIRST_CHARACTER'
  | 'INVALID_PADDING'
  | 'INVALID_NEXT_NUMBER'
  | 'NUMBER_TOO_LONG';

export interface SeriesIssue {
  readonly code: SeriesIssueCode;
  readonly field: 'prefix' | 'suffix' | 'padding' | 'nextNumber';
}

function toPositiveBigInt(n: bigint | number): bigint | undefined {
  if (typeof n === 'number' && !Number.isSafeInteger(n)) return undefined;
  const value = BigInt(n);
  return value >= 1n ? value : undefined;
}

function isValidPadding(padding: number): boolean {
  return (
    Number.isInteger(padding) && padding >= SERIES_PADDING_MIN && padding <= SERIES_PADDING_MAX
  );
}

const digitsOf = (n: bigint): number => n.toString().length;

/**
 * The width of the widest number the series renders from now on: the prefix, the digits of the
 * larger of the padded capacity (`10^padding − 1`) and the next number, and the suffix.
 */
export function seriesWidth(series: SeriesInput): number {
  const next = series.nextNumber === undefined ? 1n : BigInt(series.nextNumber);
  return series.prefix.length + Math.max(series.padding, digitsOf(next)) + series.suffix.length;
}

/**
 * Validates a series. Returns an empty list when valid.
 *
 * - The width ({@link seriesWidth}) must stay ≤ 16, so every number the padding can hold fits,
 *   and so does the next one to be issued. The issue is on `nextNumber` when the next number is
 *   wider than the padding, otherwise on `padding`.
 * - The first rendered character must be `[A-Za-z1-9]`: a prefix must start with one, and a
 *   series without a prefix must not render a leading zero, which holds once the next number
 *   has at least `padding` digits (numbers only grow).
 */
export function validateSeries(series: SeriesInput): SeriesIssue[] {
  const { prefix, suffix, padding } = series;
  const checks: readonly (readonly [boolean, SeriesIssue])[] = [
    [prefix.length > SERIES_PREFIX_MAX_LENGTH, { code: 'PREFIX_TOO_LONG', field: 'prefix' }],
    [!SERIES_CHARSET_PATTERN.test(prefix), { code: 'INVALID_CHARACTERS', field: 'prefix' }],
    [
      prefix !== '' && !DOC_NUMBER_FIRST_CHAR_PATTERN.test(prefix),
      { code: 'INVALID_FIRST_CHARACTER', field: 'prefix' },
    ],
    [suffix.length > SERIES_SUFFIX_MAX_LENGTH, { code: 'SUFFIX_TOO_LONG', field: 'suffix' }],
    [!SERIES_CHARSET_PATTERN.test(suffix), { code: 'INVALID_CHARACTERS', field: 'suffix' }],
  ];
  const issues = checks.filter(([failed]) => failed).map(([, issue]) => issue);
  if (!isValidPadding(padding)) {
    issues.push({ code: 'INVALID_PADDING', field: 'padding' });
    return issues;
  }
  let next = 1n;
  if (series.nextNumber !== undefined) {
    const parsed = toPositiveBigInt(series.nextNumber);
    if (parsed === undefined) {
      issues.push({ code: 'INVALID_NEXT_NUMBER', field: 'nextNumber' });
      return issues;
    }
    next = parsed;
  }
  if (prefix === '' && digitsOf(next) < padding) {
    issues.push({ code: 'INVALID_FIRST_CHARACTER', field: 'padding' });
  }
  if (seriesWidth({ prefix, suffix, padding, nextNumber: next }) > DOC_NUMBER_MAX_LENGTH) {
    const field = digitsOf(next) > padding ? 'nextNumber' : 'padding';
    issues.push({ code: 'NUMBER_TOO_LONG', field });
  }
  return issues;
}

/** The largest number this series can issue within 16 characters (0 when none fits). */
export function maxDocNumber(series: SeriesFormat): bigint {
  const digits = DOC_NUMBER_MAX_LENGTH - series.prefix.length - series.suffix.length;
  return digits > 0 ? 10n ** BigInt(digits) - 1n : 0n;
}

/**
 * Renders document number `n` of a series, e.g. `SI/26-27/0001`. Throws rather than ever
 * producing a number that breaks GST rule 46.
 */
export function formatDocNumber(series: SeriesFormat, n: bigint | number): string {
  const issues = validateSeries({ ...series, nextNumber: n });
  if (issues.length > 0) {
    throw new RangeError(
      `Cannot issue number ${String(n)}: ${issues.map((i) => `${i.field} ${i.code}`).join(', ')}`,
    );
  }
  return `${series.prefix}${BigInt(n).toString().padStart(series.padding, '0')}${series.suffix}`;
}
