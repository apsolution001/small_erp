export const PG_UNIQUE_VIOLATION = '23505';

/** The identifying fields of a Postgres error. None of them carries row data. */
export interface PgErrorFields {
  /** SQLSTATE. */
  readonly code: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
}

/**
 * The fields of `error` itself when it is a Postgres error, recognised by the SQLSTATE `code`
 * plus `severity` that node-postgres sets (a Node system error has a code but no severity).
 */
export function asPgError(error: unknown): PgErrorFields | undefined {
  if (!(error instanceof Error)) return undefined;
  const candidate = error as Error & {
    code?: unknown;
    severity?: unknown;
    constraint?: unknown;
    table?: unknown;
    column?: unknown;
  };
  if (typeof candidate.code !== 'string' || typeof candidate.severity !== 'string') {
    return undefined;
  }
  return {
    code: candidate.code,
    ...(typeof candidate.constraint === 'string' ? { constraint: candidate.constraint } : {}),
    ...(typeof candidate.table === 'string' ? { table: candidate.table } : {}),
    ...(typeof candidate.column === 'string' ? { column: candidate.column } : {}),
  };
}

/** The Postgres error on the error or its `cause` chain (Drizzle wraps driver errors). */
export function findPgError(error: unknown): PgErrorFields | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const pg = asPgError(current);
    if (pg !== undefined) return pg;
    current = current.cause;
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
