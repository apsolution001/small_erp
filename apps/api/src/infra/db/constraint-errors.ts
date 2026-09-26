import { ConflictError, type DomainError } from '../../common/errors/domain-error.js';
import { findPgError, isForeignKeyViolation } from './pg-errors.js';

/** Domain errors for named constraints: `{ units_tenant_code_unique: () => new ConflictError(...) }`. */
export type ConstraintErrors = Readonly<Partial<Record<string, () => DomainError>>>;

/**
 * Runs a write and turns a violation of one of the named constraints into its domain error.
 * The database is the arbiter of uniqueness and references (no check-then-insert races); this
 * gives the violation a stable code and a readable message. Anything else is rethrown as is
 * (an unmapped unique violation still becomes a generic 409 `ALREADY_EXISTS` in the filter).
 */
export async function mapConstraintErrors<T>(
  write: () => Promise<T>,
  errors: ConstraintErrors,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const constraint = findPgError(error)?.constraint;
    const toDomainError = constraint === undefined ? undefined : errors[constraint];
    if (toDomainError !== undefined) throw toDomainError();
    throw error;
  }
}

/**
 * Runs a hard delete and reports a row that other rows still reference as 409 `IN_USE`. Every
 * reference between tenant tables is a foreign key, so the database knows about all of them,
 * including the ones added by later modules.
 */
export async function deleteUnlessReferenced<T>(
  remove: () => Promise<T>,
  what: string,
): Promise<T> {
  try {
    return await remove();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictError(
        'IN_USE',
        `This ${what} is in use and cannot be deleted. Deactivate it instead.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}
