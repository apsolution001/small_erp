import { describe, expect, it } from 'vitest';
import {
  checkRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  newRefreshToken,
  refreshExpiry,
} from './refresh-token.js';

const NOW = new Date('2026-09-26T10:00:00.000Z');
const LATER = new Date('2026-10-26T10:00:00.000Z');

describe('newRefreshToken / hashRefreshToken', () => {
  it('issues opaque 256-bit tokens (43 base64url characters), never the same twice', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isWellFormedRefreshToken(a)).toBe(true);
  });

  it('stores only a SHA-256 hex digest', () => {
    const token = newRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(hashRefreshToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('refuses malformed cookie values before any lookup', () => {
    for (const bad of ['', 'short', `${'a'.repeat(43)}=`, 'a'.repeat(44), `${'a'.repeat(42)}!`]) {
      expect(isWellFormedRefreshToken(bad), bad).toBe(false);
    }
  });
});

describe('refreshExpiry', () => {
  it('is REFRESH_TOKEN_TTL_DAYS after now', () => {
    expect(refreshExpiry(NOW, 30)).toEqual(LATER);
  });
});

describe('checkRefreshToken (rotation with reuse detection, ADR 0006)', () => {
  const live = { revokedAt: null, expiresAt: LATER };

  it('accepts a live token', () => {
    expect(checkRefreshToken(live, NOW)).toBe('valid');
  });

  it('treats any revoked token as reuse, even an expired one', () => {
    expect(checkRefreshToken({ ...live, revokedAt: NOW }, NOW)).toBe('reused');
    expect(checkRefreshToken({ revokedAt: NOW, expiresAt: NOW }, LATER)).toBe('reused');
  });

  it('rejects an expired token, at the exact expiry instant too', () => {
    expect(checkRefreshToken(live, LATER)).toBe('expired');
    expect(checkRefreshToken(live, new Date(LATER.getTime() + 1))).toBe('expired');
    expect(checkRefreshToken(live, new Date(LATER.getTime() - 1))).toBe('valid');
  });

  it('reports an unknown token', () => {
    expect(checkRefreshToken(undefined, NOW)).toBe('unknown');
  });
});
