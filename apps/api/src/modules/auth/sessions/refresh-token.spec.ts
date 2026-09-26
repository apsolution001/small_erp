import { describe, expect, it } from 'vitest';
import { checkRefreshToken, refreshExpiry } from './refresh-token.js';

const NOW = new Date('2026-09-26T10:00:00.000Z');
const LATER = new Date('2026-10-26T10:00:00.000Z');

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
