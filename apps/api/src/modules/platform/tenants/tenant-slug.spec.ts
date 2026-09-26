import { describe, expect, it } from 'vitest';
import { slugify, withRandomSuffix } from './tenant-slug.js';

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('slugify', () => {
  it('turns a trade name into lower-case words joined by hyphens', () => {
    expect(slugify('Shree Ganesh Traders')).toBe('shree-ganesh-traders');
    expect(slugify('  M/s. A.B.C. & Sons (India) Pvt. Ltd. ')).toBe('m-s-a-b-c-sons-india-pvt-ltd');
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu');
  });

  it('caps the length at 50 without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(49)} bcd`);
    expect(slug).toBe('a'.repeat(49));
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it('falls back when nothing usable is left', () => {
    expect(slugify('—— ॐ ——')).toBe('company');
  });
});

describe('withRandomSuffix', () => {
  it('appends 6 base36 characters and keeps the slug format', () => {
    const slug = withRandomSuffix('shree-ganesh');
    expect(slug).toMatch(/^shree-ganesh-[a-z0-9]{6}$/);
    expect(slug).toMatch(SLUG_FORMAT);
    expect(withRandomSuffix('x')).not.toBe(withRandomSuffix('x'));
  });
});
