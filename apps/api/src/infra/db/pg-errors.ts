export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

interface PgErrorFields {
  readonly code: string;
  readonly constraint?: string;
}

/**
 * The Postgres error on the error or its `cause` chain (Drizzle wraps driver errors), recognised
 * by the SQLSTATE `code` plus `severity` that node-postgres sets.
 */
export function findPgError(error: unknown): PgErrorFields | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const candidate = current as Error & {
      code?: unknown;
      severity?: unknown;
      constraint?: unknown;
    };
    if (typeof candidate.code === 'string' && typeof candidate.severity === 'string') {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === 'string' ? { constraint: candidate.constraint } : {}),
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

/** True for a unique violation, optionally of one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return (
    pg?.code === PG_UNIQUE_VIOLATION && (constraint === undefined || pg.constraint === constraint)
  );
}

/**
 * True for a foreign-key violation, optionally of one named constraint. Deleting a referenced
 * row raises it with the referencing table's constraint name.
 */
export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return (
    pg?.code === PG_FOREIGN_KEY_VIOLATION &&
    (constraint === undefined || pg.constraint === constraint)
  );
}
