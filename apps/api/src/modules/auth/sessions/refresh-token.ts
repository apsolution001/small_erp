/**
 * Refresh tokens are opaque 256-bit secrets; only the digest is stored
 * (`refresh_tokens.token_hash`) and the token itself lives in the cookie.
 */
export {
  hashOpaqueToken as hashRefreshToken,
  isWellFormedOpaqueToken as isWellFormedRefreshToken,
  newOpaqueToken as newRefreshToken,
} from '../../../common/crypto/opaque-token.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
