import { randomBytes } from 'node:crypto';

const MAX_BASE_LENGTH = 50;
const FALLBACK = 'company';

/**
 * URL-safe slug from a company name (`tenants_slug_format`): lower-case letters and digits
 * separated by single hyphens, at most 50 characters so a suffix still fits in 63.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Drop the combining accents NFKD split off, so "Café" becomes "cafe", not "caf-e".
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? FALLBACK : slug;
}

/** `<base>-<6 random base36 characters>`, for when the plain slug is taken. */
export function withRandomSuffix(base: string): string {
  const suffix = [...randomBytes(6)].map((b) => (b % 36).toString(36)).join('');
  return `${base}-${suffix}`;
}
