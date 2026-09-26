import { describe, expect, it } from 'vitest';
import { hashOpaqueToken, isWellFormedOpaqueToken, newOpaqueToken } from './opaque-token.js';

describe('opaque tokens (refresh tokens, invitation links)', () => {
  it('issues 256-bit tokens (43 base64url characters), never the same twice', () => {
    const a = newOpaqueToken();
    const b = newOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isWellFormedOpaqueToken(a)).toBe(true);
  });

  it('stores only a SHA-256 hex digest', () => {
    const token = newOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashOpaqueToken(token));
    expect(hash).not.toContain(token);
    expect(hashOpaqueToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('refuses malformed values before any lookup', () => {
    for (const bad of ['', 'short', `${'a'.repeat(43)}=`, 'a'.repeat(44), `${'a'.repeat(42)}!`]) {
      expect(isWellFormedOpaqueToken(bad), bad).toBe(false);
    }
  });
});
