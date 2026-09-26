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
 * Whether the digit block `digits` is what a series with `padding` renders for some n ≥ 1:
 * at least `padding` digits, not all zeros, and no leading zero once wider than the padding.
 */
function isRenderedDigits(digits: string, padding: number): boolean {
  return (
    digits.length >= padding &&
    /[1-9]/.test(digits) &&
    (digits.length === padding || !digits.startsWith('0'))
  );
}

/** Each position of a number `length` characters wide: a fixed character, or null for a digit. */
function layoutOf(series: SeriesFormat, length: number): (string | null)[] | undefined {
  const digits = length - series.prefix.length - series.suffix.length;
  if (digits < series.padding) return undefined;
  return [...series.prefix, ...Array<null>(digits).fill(null), ...series.suffix];
}

function collideAtLength(a: SeriesFormat, b: SeriesFormat, length: number): boolean {
  const la = layoutOf(a, length);
  const lb = layoutOf(b, length);
  if (la === undefined || lb === undefined) return false;
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    const ca = la[i] ?? null;
    const cb = lb[i] ?? null;
    if (ca !== null && cb !== null && ca !== cb) return false;
    const fixed = ca ?? cb;
    if (fixed !== null && (ca === null || cb === null) && !/\d/.test(fixed)) return false;
    // A position that is a digit in both is free; 1 satisfies every digit-block rule at once.
    chars.push(fixed ?? '1');
  }
  const digitsOfSeries = (s: SeriesFormat) =>
    chars.slice(s.prefix.length, length - s.suffix.length).join('');
  return (
    isRenderedDigits(digitsOfSeries(a), a.padding) && isRenderedDigits(digitsOfSeries(b), b.padding)
  );
}

/**
 * Whether two series can ever render the same document number (spec 02: a number is unique per
 * GSTIN, document family and FY). Exact for every n ≥ 1 within 16 characters, whatever the next
 * numbers: `SI/` padding 4 and `SI/0` padding 3 both render `SI/0001`, while `SI/` and `SI/…/B`
 * never meet. Series are compared as stored (upper-cased affixes).
 */
export function seriesNumbersCollide(a: SeriesFormat, b: SeriesFormat): boolean {
  for (let length = 1; length <= DOC_NUMBER_MAX_LENGTH; length++) {
    if (collideAtLength(a, b, length)) return true;
  }
  return false;
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
