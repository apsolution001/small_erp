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

/** When a session started at `now` ends whatever its activity (`SESSION_ABSOLUTE_DAYS`). */
export function sessionAbsoluteExpiry(now: Date, absoluteDays: number): Date {
  return new Date(now.getTime() + absoluteDays * DAY_MS);
}

/**
 * Expiry of a refresh token issued at `now`: `SESSION_IDLE_DAYS` later (a session unused that
 * long ends), but never after the session's absolute end.
 */
export function refreshExpiry(now: Date, idleDays: number, absoluteExpiresAt: Date): Date {
  const idle = now.getTime() + idleDays * DAY_MS;
  return new Date(Math.min(idle, absoluteExpiresAt.getTime()));
}

export type RefreshCheck = 'valid' | 'expired' | 'reused';

/**
 * What presenting this stored token of this session means. A revoked token, or any token of a
 * revoked session, is reuse whatever its age: it was already exchanged (or its session ended), so
 * whoever holds it now may be an attacker, and the whole family must go (ADR 0006). Otherwise a
 * token past its own expiry or its session's absolute end is simply expired.
 */
export function checkRefreshToken(
  token: { readonly revokedAt: Date | null; readonly expiresAt: Date },
  session: { readonly revokedAt: Date | null; readonly absoluteExpiresAt: Date },
  now: Date,
): RefreshCheck {
  if (token.revokedAt !== null || session.revokedAt !== null) return 'reused';
  const at = now.getTime();
  if (token.expiresAt.getTime() <= at || session.absoluteExpiresAt.getTime() <= at) {
    return 'expired';
  }
  return 'valid';
}
