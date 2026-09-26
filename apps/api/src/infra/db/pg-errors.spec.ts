import { describe, expect, it } from 'vitest';
import {
  findPgError,
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from './pg-errors.js';

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

  it('recognises foreign-key and check violations', () => {
    const fk = new Error('Failed query', { cause: pgError('23503', 'memberships_role_fk') });
    expect(isForeignKeyViolation(fk)).toBe(true);
    expect(isForeignKeyViolation(fk, 'memberships_role_fk')).toBe(true);
    expect(isForeignKeyViolation(fk, 'invitations_role_fk')).toBe(false);
    expect(isCheckViolation(fk)).toBe(false);
    const check = pgError('23514', 'invitations_role_while_pending');
    expect(isCheckViolation(check, 'invitations_role_while_pending')).toBe(true);
    expect(isUniqueViolation(check)).toBe(false);
  });

  it('ignores Node system errors, which have a code but no severity', () => {
    expect(findPgError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(
      undefined,
    );
  });
});
