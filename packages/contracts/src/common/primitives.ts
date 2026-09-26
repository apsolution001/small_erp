import {
  CURRENT_STATE_CODES,
  PAISE_PATTERN,
  PLACE_OF_SUPPLY_CODES,
  QTY_PATTERN,
  RATE_PATTERN,
  STATE_CODES,
  isValidFyLabel,
  isValidGstin,
} from '@ekaro/core';
import { z } from 'zod';

export const uuidSchema = z.uuid();

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/**
 * Money on the wire: a string of integer paise (ADR 0005), e.g. `"1234550"` = ₹12,345.50.
 * Bounded to Postgres `bigint`. Convert with `Money.parse` from `@ekaro/core`.
 */
export const moneySchema = z
  .string()
  .regex(PAISE_PATTERN, { message: 'Expected an integer number of paise', abort: true })
  .refine((v) => {
    const n = BigInt(v);
    return n >= INT64_MIN && n <= INT64_MAX;
  }, 'Amount is out of range');

export const nonNegativeMoneySchema = moneySchema.refine(
  (v) => !v.startsWith('-'),
  'Amount must not be negative',
);

/** A quantity: decimal string that fits `numeric(20,6)`. The string is preserved exactly. */
export const qtySchema = z
  .string()
  .regex(QTY_PATTERN, 'Expected a decimal with at most 6 decimal places');

const isZeroDecimal = (v: string): boolean => /^-?0+(\.0+)?$/.test(v);

export const nonNegativeQtySchema = qtySchema.refine(
  (v) => !v.startsWith('-'),
  'Quantity must not be negative',
);

export const positiveQtySchema = qtySchema.refine(
  (v) => !v.startsWith('-') && !isZeroDecimal(v),
  'Quantity must be greater than zero',
);

/** A unit rate in rupees: non-negative decimal string that fits `numeric(20,6)`. */
export const rateSchema = z
  .string()
  .regex(RATE_PATTERN, 'Expected a non-negative rate with at most 6 decimal places');

/** A percentage that fits `numeric(7,4)`: 0 to 999.9999 (cess slabs can exceed 100%). */
export const percentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Expected a percentage with at most 4 decimal places');

/** GSTIN: trimmed and upper-cased, then checked for format, state code and checksum. */
export const gstinSchema = z.string().trim().toUpperCase().refine(isValidGstin, 'Invalid GSTIN');

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN');

/**
 * Any code in the GST state table, including the legacy 25 and 28. Use it to read stored and
 * back-dated data; new addresses and state fields take {@link currentStateCodeSchema}.
 */
export const stateCodeSchema = z.enum(STATE_CODES);

/** A state code in use today (no legacy 25 or 28): every master address and state field. */
export const currentStateCodeSchema = z.enum(CURRENT_STATE_CODES);

/**
 * A place of supply: a current state code, `96` (Other Countries) or `99` (Centre
 * Jurisdiction). 96 and 99 are never valid as an address state or a GSTIN prefix.
 */
export const placeOfSupplySchema = z.enum(PLACE_OF_SUPPLY_CODES);

/** Indian PIN code: 6 digits, the first is never 0. */
export const pincodeSchema = z.string().regex(/^[1-9]\d{5}$/, 'Invalid pincode');

/** Indian mobile number in E.164 (`+91` followed by 10 digits starting 6–9). */
export const mobileSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Expected +91 and a 10-digit mobile');

/** Indian phone number in E.164 (`+91` followed by 10 digits); allows landlines. */
export const phoneSchema = z
  .string()
  .regex(/^\+91[1-9]\d{9}$/, 'Expected +91 and a 10-digit number');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** ISO 3166-1 alpha-2 country code. */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Expected a 2-letter country code');

/** A calendar date `YYYY-MM-DD` (document dates, `date` columns). */
export const isoDateSchema = z.iso.date();

/** An instant with offset (`timestamptz` columns). */
export const timestampSchema = z.iso.datetime({ offset: true });

/** Indian financial year label, e.g. `2026-27`. */
export const fyLabelSchema = z
  .string()
  .refine(isValidFyLabel, 'Expected a financial year like 2026-27');

/** Trimmed, non-empty text of at most `max` characters. */
export const text = (max: number) => z.string().trim().min(1).max(max);

/** Optimistic-locking version sent back on update. */
export const versionSchema = z.int().min(1);

/** Columns every tenant record returns (database standard). */
export const recordMetaShape = {
  id: uuidSchema,
  version: versionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

/** A reference to another record, shown by name. */
export const refSchema = z.object({ id: uuidSchema, name: z.string() });
