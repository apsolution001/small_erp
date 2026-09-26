import { describe, expect, it } from 'vitest';
import { findPgError, isForeignKeyViolation, isUniqueViolation } from './pg-errors.js';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error('driver error'), { code, severity: 'ERROR', constraint });

describe('pg errors', () => {
  it('finds the driver error through Drizzle wrapping', () => {
    const wrapped = new Error('Failed query', { cause: pgError('23505', 'users_email_unique') });
    expect(findPgError(wrapped)).toEqual({ code: '23505', constraint: 'users_email_unique' });
    expect(findPgError(new Error('plain'))).toBeUndefined();
    expect(findPgError('not an error')).toBeUndefined();
  });

  it('recognises a unique violation, optionally of a named constraint', () => {
    const error = new Error('Failed query', { cause: pgError('23505', 'users_email_unique') });
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'users_email_unique')).toBe(true);
    expect(isUniqueViolation(error, 'tenants_slug_unique')).toBe(false);
    expect(isUniqueViolation(pgError('23503'))).toBe(false);
  });

  it('recognises a foreign-key violation, optionally of a named constraint', () => {
    const error = new Error('Failed query', { cause: pgError('23503', 'items_base_unit_fk') });
    expect(isForeignKeyViolation(error)).toBe(true);
    expect(isForeignKeyViolation(error, 'items_base_unit_fk')).toBe(true);
    expect(isForeignKeyViolation(error, 'godowns_branch_fk')).toBe(false);
    expect(isForeignKeyViolation(pgError('23505'))).toBe(false);
  });

  it('ignores Node system errors, which have a code but no severity', () => {
    expect(findPgError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(
      undefined,
    );
  });
});
