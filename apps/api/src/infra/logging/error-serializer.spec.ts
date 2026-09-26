import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../common/errors/domain-error.js';
import { serializeError } from './error-serializer.js';
import { buildLoggerParams, loggerOptions } from './logger.options.js';

const EMAIL = 'asha.mehta@example.com';
const BCRYPT = '$2b$12$abcdefghijklmnopqrstuuSomeBcryptHashValueForTests0123456';
const TOKEN_HASH = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SECRETS = [EMAIL, BCRYPT, TOKEN_HASH, 'insert into', 'Key (email)'];

/** The error node-postgres raises for a unique violation, with the row data in `detail`. */
function uniqueViolation(): pg.DatabaseError {
  const error = new pg.DatabaseError(
    'duplicate key value violates unique constraint "users_email_unique"',
    120,
    'error',
  );
  error.severity = 'ERROR';
  error.code = '23505';
  error.detail = `Key (email)=(${EMAIL}) already exists.`;
  error.table = 'users';
  error.constraint = 'users_email_unique';
  error.schema = 'public';
  return error;
}

/** What Drizzle throws: the SQL and every parameter, in the message and as properties. */
function failedInsert(): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "users" ("email", "password_hash", "token_hash") values ($1, $2, $3)',
    [EMAIL, BCRYPT, TOKEN_HASH],
    uniqueViolation(),
  );
}

const SAFE_SUMMARY = {
  type: 'DrizzleQueryError',
  sqlstate: '23505',
  constraint: 'users_email_unique',
  table: 'users',
};

function captureLines(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { stream, lines };
}

describe('serializeError', () => {
  it('reduces a DrizzleQueryError to its SQLSTATE, constraint, table and column', () => {
    expect(serializeError(failedInsert())).toEqual(SAFE_SUMMARY);
  });

  it('reduces any error caused by a pg DatabaseError, and the DatabaseError itself', () => {
    const wrapped = new Error(`query failed for ${EMAIL}`, { cause: uniqueViolation() });
    expect(serializeError(wrapped)).toEqual({ ...SAFE_SUMMARY, type: 'Error' });
    expect(serializeError(uniqueViolation())).toEqual({ ...SAFE_SUMMARY, type: 'DatabaseError' });
  });

  it('keeps type, code, message and stack of other errors, and sanitises their causes', () => {
    const conflict = new ConflictError('EMAIL_TAKEN', 'This email is already registered.', {
      cause: failedInsert(),
    });
    expect(serializeError(conflict)).toEqual({
      type: 'ConflictError',
      code: 'EMAIL_TAKEN',
      status: 409,
      message: 'This email is already registered.',
      stack: conflict.stack,
      cause: SAFE_SUMMARY,
    });
  });

  it('leaves values that are not errors alone, and stops on cause cycles', () => {
    expect(serializeError('text')).toBe('text');
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.assign(a, { cause: b });
    expect(JSON.stringify(serializeError(a))).toContain('"message":"a"');
  });

  it('never lets the SQL, parameters or row data of a failed query reach a log line', () => {
    const { stream, lines } = captureLines();
    const logger = pino(loggerOptions({ LOG_LEVEL: 'info', NODE_ENV: 'production' }), stream);
    logger.error({ err: failedInsert() }, 'direct');
    logger.error({ err: new ConflictError('EMAIL_TAKEN', 'taken', { cause: failedInsert() }) });
    logger.error(failedInsert());

    const { stream: httpStream, lines: httpLines } = captureLines();
    const { pinoHttp: options } = buildLoggerParams({ LOG_LEVEL: 'info', NODE_ENV: 'production' });
    const httpLogger = pinoHttp({ ...(options as object) }, httpStream).logger;
    httpLogger.error({ err: failedInsert() }, 'through pino-http');

    const all = [...lines, ...httpLines];
    expect(all).toHaveLength(4);
    for (const line of all) {
      for (const secret of SECRETS) expect(line).not.toContain(secret);
      expect(line).toContain('"sqlstate":"23505"');
      expect(line).toContain('"constraint":"users_email_unique"');
    }
  });
});
