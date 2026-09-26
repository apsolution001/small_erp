/**
 * Document numbering series (MS-05, ADR 0010). GST rule 46 requires invoice numbers of at most
 * 16 characters using only letters, digits, `-` and `/`.
 */

export const DOC_NUMBER_MAX_LENGTH = 16;
export const SERIES_PREFIX_MAX_LENGTH = 10;
export const SERIES_SUFFIX_MAX_LENGTH = 6;
export const SERIES_PADDING_MIN = 1;
export const SERIES_PADDING_MAX = 8;
/** Characters allowed in a prefix or suffix (and so in the rendered number). */
export const SERIES_CHARSET_PATTERN = /^[A-Za-z0-9/-]*$/;

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

/**
 * Validates a series. Returns an empty list when valid. The rendered width is
 * `prefix + max(padding, digits(nextNumber)) + suffix` and must stay ≤ 16, so every number the
 * padding can hold (up to 10^padding − 1) fits, and so does the next one to be issued.
 */
export function validateSeries(series: SeriesInput): SeriesIssue[] {
  const { prefix, suffix, padding } = series;
  const checks: readonly (readonly [boolean, SeriesIssue])[] = [
    [prefix.length > SERIES_PREFIX_MAX_LENGTH, { code: 'PREFIX_TOO_LONG', field: 'prefix' }],
    [!SERIES_CHARSET_PATTERN.test(prefix), { code: 'INVALID_CHARACTERS', field: 'prefix' }],
    [suffix.length > SERIES_SUFFIX_MAX_LENGTH, { code: 'SUFFIX_TOO_LONG', field: 'suffix' }],
    [!SERIES_CHARSET_PATTERN.test(suffix), { code: 'INVALID_CHARACTERS', field: 'suffix' }],
  ];
  const issues = checks.filter(([failed]) => failed).map(([, issue]) => issue);
  if (!isValidPadding(padding)) {
    issues.push({ code: 'INVALID_PADDING', field: 'padding' });
    return issues;
  }
  const fixed = prefix.length + suffix.length;
  if (fixed + padding > DOC_NUMBER_MAX_LENGTH) {
    issues.push({ code: 'NUMBER_TOO_LONG', field: 'padding' });
  }
  if (series.nextNumber !== undefined) {
    const next = toPositiveBigInt(series.nextNumber);
    if (next === undefined) {
      issues.push({ code: 'INVALID_NEXT_NUMBER', field: 'nextNumber' });
    } else if (
      next.toString().length > padding &&
      fixed + next.toString().length > DOC_NUMBER_MAX_LENGTH
    ) {
      issues.push({ code: 'NUMBER_TOO_LONG', field: 'nextNumber' });
    }
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
