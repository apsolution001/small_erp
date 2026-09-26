import { DrizzleQueryError } from 'drizzle-orm/errors';
import { asPgError } from '../db/pg-errors.js';

/**
 * What a failed query may say in a log line: which statement class failed and on which object.
 * Never the SQL, its parameters (password hashes, emails, token hashes), the driver message or
 * `detail` (which quotes row values), nor a stack.
 */
export interface SafeDatabaseError {
  readonly type: string;
  readonly sqlstate?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
}

const MAX_CAUSE_DEPTH = 5;

/** The name of the error's class (`DrizzleQueryError`, `ConflictError`...). */
function typeOf(error: Error): string {
  const ctor: unknown = error.constructor;
  return typeof ctor === 'function' && ctor.name !== '' ? ctor.name : error.name;
}

/**
 * pino-http runs pino's standard serializer before a custom one and keeps the original error in
 * the non-enumerable `raw` property. Work on that original, never on the standard output, whose
 * message already has every cause's message (the SQL of a Drizzle error) appended.
 */
function originalOf(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    return value.raw;
  }
  return value;
}

/** A Drizzle query error, a pg `DatabaseError`, or an error directly caused by one. */
function asDatabaseError(error: Error): SafeDatabaseError | undefined {
  const pg = asPgError(error) ?? asPgError(error.cause);
  if (pg === undefined && !(error instanceof DrizzleQueryError)) return undefined;
  return {
    type: typeOf(error),
    ...(pg === undefined
      ? {}
      : {
          sqlstate: pg.code,
          ...(pg.constraint === undefined ? {} : { constraint: pg.constraint }),
          ...(pg.table === undefined ? {} : { table: pg.table }),
          ...(pg.column === undefined ? {} : { column: pg.column }),
        }),
  };
}

function serialize(error: Error, depth: number): Record<string, unknown> {
  const database = asDatabaseError(error);
  if (database !== undefined) return { ...database };
  const fields = error as Error & { code?: unknown; status?: unknown };
  const serialized: Record<string, unknown> = { type: typeOf(error) };
  if (typeof fields.code === 'string' || typeof fields.code === 'number') {
    serialized.code = fields.code;
  }
  if (typeof fields.status === 'number') serialized.status = fields.status;
  serialized.message = error.message;
  serialized.stack = error.stack;
  if (error.cause instanceof Error && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = serialize(error.cause, depth + 1);
  }
  return serialized;
}

/**
 * The `err` serializer of every logger, also used by `ProblemDetailsFilter` (security standard:
 * no secrets or personal data in logs). Database errors keep only {@link SafeDatabaseError};
 * other errors keep type, `code`, `status`, message and stack, with their causes serialized the
 * same way. Other enumerable properties are dropped (driver errors carry commands and params).
 */
export function serializeError(value: unknown): unknown {
  const original = originalOf(value);
  return original instanceof Error ? serialize(original, 0) : original;
}

/** A log message for an error logged without one: never a database error's own message. */
export function logMessageOf(error: Error): string {
  return asDatabaseError(error) === undefined ? error.message : 'Database query failed';
}
