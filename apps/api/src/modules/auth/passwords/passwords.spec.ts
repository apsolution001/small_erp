import { describe, expect, it } from 'vitest';
import { isCommonPassword } from './common-passwords.js';
import { BCRYPT_COST, PasswordHasher } from './password-hasher.js';

describe('isCommonPassword', () => {
  it('rejects listed passwords in any case, and repeated characters', () => {
    expect(isCommonPassword('Password@123')).toBe(true);
    expect(isCommonPassword('QWERTYUIOP')).toBe(true);
    expect(isCommonPassword('zzzzzzzzzzzz')).toBe(true);
  });

  it('accepts an uncommon passphrase', () => {
    expect(isCommonPassword('correct horse battery')).toBe(false);
  });
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with bcrypt cost 12 and verifies', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(BCRYPT_COST).toBe(12);
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(await hasher.verify('correct horse battery', hash)).toBe(true);
    expect(await hasher.verify('correct horse batterY', hash)).toBe(false);
  });

  it('spends a bcrypt comparison even when there is no account', async () => {
    expect(await hasher.verifyNothing('anything at all')).toBe(false);
  });
});
