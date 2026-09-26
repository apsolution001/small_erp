import { describe, expect, it } from 'vitest';
import {
  checkRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  newRefreshToken,
  refreshExpiry,
  sessionAbsoluteExpiry,
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

describe('session lifetimes (ADR 0016)', () => {
  const absolute = new Date('2026-10-26T10:00:00.000Z');

  it('ends a session SESSION_ABSOLUTE_DAYS after login', () => {
    expect(sessionAbsoluteExpiry(NOW, 30)).toEqual(absolute);
  });

  it('expires a refresh token SESSION_IDLE_DAYS after issue, never after the absolute end', () => {
    expect(refreshExpiry(NOW, 7, absolute)).toEqual(new Date('2026-10-03T10:00:00.000Z'));
    const nearEnd = new Date('2026-10-24T10:00:00.000Z');
    expect(refreshExpiry(nearEnd, 7, absolute)).toEqual(absolute);
  });
});

describe('checkRefreshToken (rotation with reuse detection, ADR 0006)', () => {
  const live = { revokedAt: null, expiresAt: LATER };
  const session = { revokedAt: null, absoluteExpiresAt: LATER };

  it('accepts a live token of a live session', () => {
    expect(checkRefreshToken(live, session, NOW)).toBe('valid');
  });

  it('treats any revoked token as reuse, even an expired one', () => {
    expect(checkRefreshToken({ ...live, revokedAt: NOW }, session, NOW)).toBe('reused');
    expect(checkRefreshToken({ revokedAt: NOW, expiresAt: NOW }, session, LATER)).toBe('reused');
  });

  it('treats a token of a revoked session as reuse', () => {
    expect(checkRefreshToken(live, { ...session, revokedAt: NOW }, NOW)).toBe('reused');
  });

  it('rejects an expired token, at the exact expiry instant too', () => {
    expect(checkRefreshToken(live, session, LATER)).toBe('expired');
    expect(checkRefreshToken(live, session, new Date(LATER.getTime() + 1))).toBe('expired');
    expect(checkRefreshToken(live, session, new Date(LATER.getTime() - 1))).toBe('valid');
  });

  it('rejects a live token once the session reached its absolute end', () => {
    expect(checkRefreshToken(live, { ...session, absoluteExpiresAt: NOW }, NOW)).toBe('expired');
  });
});
