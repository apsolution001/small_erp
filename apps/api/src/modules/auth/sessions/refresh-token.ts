import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
/** 32 bytes in unpadded base64url. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A new opaque refresh token: 256 random bits (security standard), base64url. */
export function newRefreshToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Only this digest is stored (`refresh_tokens.token_hash`); the token lives in the cookie. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Screens a cookie value before it reaches the database. */
export function isWellFormedRefreshToken(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}

export function refreshExpiry(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * DAY_MS);
}

export type RefreshCheck = 'valid' | 'unknown' | 'expired' | 'reused';

/**
 * What presenting this stored token means. A revoked token is reuse whatever its age: it was
 * already exchanged (or its session ended), so whoever holds it now may be an attacker, and the
 * whole family must go (ADR 0006). An unrevoked token past its expiry is simply expired.
 */
export function checkRefreshToken(
  row: { readonly revokedAt: Date | null; readonly expiresAt: Date } | undefined,
  now: Date,
): RefreshCheck {
  if (row === undefined) return 'unknown';
  if (row.revokedAt !== null) return 'reused';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
