import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
/** 32 bytes in unpadded base64url. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new opaque bearer secret (refresh tokens, invitation links): 256 random bits (security
 * standard), base64url. Only its {@link hashOpaqueToken} digest is ever stored.
 */
export function newOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Hex SHA-256: what the database keeps. A 256-bit random secret needs no salt or slow hash. */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Screens a presented value before it reaches the database. */
export function isWellFormedOpaqueToken(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}
