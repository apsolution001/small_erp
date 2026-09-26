import { type ArgumentsHost, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { problemSchema } from '@ekaro/contracts';
import { ThrottlerException } from '@nestjs/throttler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  LockedError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from './domain-error.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsFilter,
  toProblemDetails,
} from './problem-details.filter.js';

interface CapturedResponse {
  status?: number;
  headers: Record<string, string>;
  body?: unknown;
}

function httpHost(options: { requestId?: string; headersSent?: boolean } = {}): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { headers: {} };
  const res = {
    headersSent: options.headersSent ?? false,
    status(code: number) {
      captured.status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    send(body: string) {
      captured.body = JSON.parse(body);
      return res;
    },
  };
  const req = { id: options.requestId };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toProblemDetails', () => {
  it.each([
    [new UnauthorizedError('UNAUTHENTICATED', 'Sign in required.'), 401, 'Unauthorized'],
    [new ForbiddenError('FORBIDDEN', 'Missing permission masters.item:edit.'), 403, 'Forbidden'],
    [new NotFoundError('NOT_FOUND', 'Item not found.'), 404, 'Not Found'],
    [new LockedError('ACCOUNT_LOCKED', 'Try again in 15 minutes.'), 423, 'Locked'],
    [new ConflictError('EMAIL_TAKEN', 'This email is already registered.'), 409, 'Conflict'],
    [
      new BusinessRuleError('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded.'),
      422,
      'Unprocessable Entity',
    ],
    [new ServiceUnavailableError('SERVICE_UNAVAILABLE', 'redis'), 503, 'Service Unavailable'],
  ])('maps %o to its status, title, code and detail', (error, status, title) => {
    expect(toProblemDetails(error)).toEqual({
      type: 'about:blank',
      title,
      status,
      code: error.code,
      detail: error.message,
    });
  });

  it('keeps field errors of a ValidationError', () => {
    const error = new ValidationError([
      { path: 'email', message: 'Invalid email', code: 'invalid_format' },
    ]);
    expect(toProblemDetails(error)).toEqual({
      type: 'about:blank',
      title: 'Unprocessable Entity',
      status: 422,
      code: 'VALIDATION_FAILED',
      detail: 'The request is invalid.',
      errors: [{ path: 'email', message: 'Invalid email', code: 'invalid_format' }],
    });
  });

  it('maps a ZodError to 422 with one entry per issue (dotted path, zod code)', () => {
    const schema = z.object({
      name: z.string().min(1),
      lines: z.array(z.object({ qty: z.number().positive() })),
    });
    const result = schema.safeParse({ name: '', lines: [{ qty: -1 }] });
    expect(result.success).toBe(false);
    const problem = toProblemDetails(result.error);
    expect(problem.status).toBe(422);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors).toEqual([
      { path: 'name', message: expect.any(String) as string, code: 'too_small' },
      { path: 'lines.0.qty', message: expect.any(String) as string, code: 'too_small' },
    ]);
  });

  it('maps Nest HTTP exceptions to a stable code and keeps the client-safe message', () => {
    expect(toProblemDetails(new NotFoundException('Cannot GET /api/v1/nope'))).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Cannot GET /api/v1/nope',
    });
    expect(toProblemDetails(new ThrottlerException())).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(toProblemDetails(new HttpException('teapot', 418))).toMatchObject({
      status: 418,
      code: 'BAD_REQUEST',
      detail: 'teapot',
    });
  });

  it('never exposes the message of a 5xx HttpException', () => {
    const problem = toProblemDetails(new HttpException('pool exhausted at 10.0.0.4', 502));
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred.',
    });
  });

  it('maps a unique violation (also when wrapped by Drizzle) to 409 without leaking the constraint', () => {
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "tenants_slug_unique"'),
      {
        code: '23505',
        severity: 'ERROR',
        constraint: 'tenants_slug_unique',
      },
    );
    const wrapped = new Error('Failed query: insert into "tenants" ...', { cause: pgError });
    const problem = toProblemDetails(wrapped);
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'ALREADY_EXISTS',
      detail: 'A record with the same unique value already exists.',
    });
  });

  it('maps unknown errors to a generic 500', () => {
    expect(toProblemDetails(new TypeError('secret internals: password=hunter2'))).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred.',
    });
    expect(toProblemDetails('a thrown string')).toMatchObject({ status: 500 });
  });

  it('always produces a body that satisfies the contracts problemSchema', () => {
    const samples: unknown[] = [
      new ValidationError([{ path: 'email', message: 'Invalid email', code: 'invalid_format' }]),
      new ConflictError('EMAIL_TAKEN', 'This email is already registered.'),
      new NotFoundException(),
      new ThrottlerException(),
      new HttpException('teapot', 418),
      new HttpException('bad gateway', 502),
      Object.assign(new Error('dup'), { code: '23505', severity: 'ERROR' }),
      new TypeError('boom'),
    ];
    for (const sample of samples) {
      const body = toProblemDetails(sample);
      expect(problemSchema.parse(body)).toEqual(body);
    }
  });
});

describe('ProblemDetailsFilter', () => {
  it('writes application/problem+json with the request id', () => {
    const { host, captured } = httpHost({ requestId: 'req-123' });
    new ProblemDetailsFilter().catch(new NotFoundError('NOT_FOUND', 'Item not found.'), host);
    expect(captured.status).toBe(404);
    expect(captured.headers['content-type']).toBe(`${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
    expect(captured.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Item not found.',
      requestId: 'req-123',
    });
  });

  it('logs unexpected errors with the original error, and 4xx errors not at all', () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const boom = new Error('boom');

    new ProblemDetailsFilter().catch(new ConflictError('CONFLICT', 'y'), httpHost().host);
    expect(logError).not.toHaveBeenCalled();

    const { host, captured } = httpHost();
    new ProblemDetailsFilter().catch(boom, host);
    expect(captured.status).toBe(500);
    expect(JSON.stringify(captured.body)).not.toContain('boom');
    expect(logError).toHaveBeenCalledWith({ err: boom }, 'Unhandled error');
  });

  it('does not write when headers were already sent', () => {
    const { host, captured } = httpHost({ headersSent: true });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new ProblemDetailsFilter().catch(new Error('late'), host);
    expect(captured.status).toBeUndefined();
  });
});
