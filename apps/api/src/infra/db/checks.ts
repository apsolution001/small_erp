import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

const SAFE_LITERAL = /^[A-Za-z0-9_ .:/-]*$/;

/**
 * `<column> in ('a', 'b')` for enum check constraints (database standard: text + check). The values
 * are code constants, never input; anything outside a plain literal alphabet is refused anyway.
 */
export function inList(column: AnyColumn, values: readonly string[]): SQL {
  const unsafe = values.find((v) => !SAFE_LITERAL.test(v));
  if (unsafe !== undefined) throw new Error(`inList: unsafe literal "${unsafe}"`);
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}

/** `char_length(<column>) between <min> and <max>` (nullable columns pass when null). */
export function lengthBetween(column: AnyColumn, min: number, max: number): SQL {
  return sql`char_length(${column}) between ${sql.raw(String(min))} and ${sql.raw(String(max))}`;
}

/** GSTIN format (spec 02 §1); the checksum is verified in the app (`@ekaro/core`). */
export function gstinFormat(column: AnyColumn): SQL {
  return sql`${column} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`;
}

/** Indian PIN code: 6 digits, the first is never 0. */
export function pincodeFormat(column: AnyColumn): SQL {
  return sql`${column} ~ '^[1-9][0-9]{5}$'`;
}

/** A GST state code: two digits (the list itself lives in `@ekaro/core`). */
export function stateCodeFormat(column: AnyColumn): SQL {
  return sql`${column} ~ '^[0-9]{2}$'`;
}
