import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../common/errors/domain-error.js';
import { deleteUnlessReferenced, mapConstraintErrors } from './constraint-errors.js';

const pgError = (code: string, constraint?: string) =>
  new Error('Failed query', {
    cause: Object.assign(new Error('driver'), { code, severity: 'ERROR', constraint }),
  });

describe('mapConstraintErrors', () => {
  const errors = {
    units_tenant_code_unique: () => new ConflictError('ALREADY_EXISTS', 'Code taken'),
  };

  it('returns the result of a successful write', async () => {
    await expect(mapConstraintErrors(() => Promise.resolve(42), errors)).resolves.toBe(42);
  });

  it('maps a named constraint to its domain error', async () => {
    await expect(
      mapConstraintErrors(
        () => Promise.reject(pgError('23505', 'units_tenant_code_unique')),
        errors,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_EXISTS', message: 'Code taken' });
  });

  it('rethrows other constraints and other errors unchanged', async () => {
    const other = pgError('23505', 'units_tenant_id_unique');
    await expect(mapConstraintErrors(() => Promise.reject(other), errors)).rejects.toBe(other);
    const plain = new Error('boom');
    await expect(mapConstraintErrors(() => Promise.reject(plain), errors)).rejects.toBe(plain);
  });
});

describe('deleteUnlessReferenced', () => {
  it('reports a referenced row as 409 IN_USE', async () => {
    await expect(
      deleteUnlessReferenced(() => Promise.reject(pgError('23503', 'items_base_unit_fk')), 'unit'),
    ).rejects.toMatchObject({ status: 409, code: 'IN_USE' });
  });

  it('passes results and other errors through', async () => {
    await expect(deleteUnlessReferenced(() => Promise.resolve('ok'), 'unit')).resolves.toBe('ok');
    const other = pgError('23505');
    await expect(deleteUnlessReferenced(() => Promise.reject(other), 'unit')).rejects.toBe(other);
  });
});
