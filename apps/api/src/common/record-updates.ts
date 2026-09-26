import { type z } from 'zod';
import { ConflictError, ValidationError } from './errors/domain-error.js';

/**
 * Optimistic locking (backend standard): an update carries the `version` it read. The service
 * reads the row `FOR UPDATE`, so the comparison and the write are atomic within the request's
 * transaction.
 */
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new ConflictError(
      'VERSION_CONFLICT',
      'This record was changed by someone else. Reload it and try again.',
    );
  }
}

/**
 * The fields a PATCH body changes: everything it sent except `version`. A parsed update schema
 * has only the keys the client sent (JSON has no `undefined`), so absent fields stay absent.
 */
export function changesOf<T extends { readonly version: number }>(patch: T): Omit<T, 'version'> {
  const { version: _version, ...changes } = patch;
  return changes;
}

/**
 * Validates the record a PATCH would produce: `schema.parse({ ...existing, ...changes })` (spec 02
 * §3, T-102 decision 3), so cross-field rules run on the whole record, not only on the fields
 * sent. `existing` is the stored record in its contract shape. Failures are a 422 with the paths
 * of the offending fields.
 */
export function parseMergedRecord<S extends z.ZodType>(
  schema: S,
  existing: object,
  changes: object,
): z.output<S> {
  const result = schema.safeParse({ ...existing, ...changes });
  if (!result.success) throw ValidationError.fromZod(result.error);
  return result.data;
}
