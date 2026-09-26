import { describe, expect, it } from 'vitest';
import { pathsOf } from '../testing/paths.js';
import { ERROR_CODES, ErrorCode, problemSchema } from './errors.js';

describe('ErrorCode', () => {
  it('is a stable SCREAMING_SNAKE catalogue with no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z]+(_[A-Z0-9]+)*$/);
  });

  it('includes the codes the specs name', () => {
    for (const code of [
      'VALIDATION_FAILED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VERSION_CONFLICT',
      'EMAIL_TAKEN',
      'GSTIN_INACTIVE',
      'INVALID_CREDENTIALS',
      'ACCOUNT_LOCKED',
      'REFRESH_REUSED',
      'ROLE_IN_USE',
      'IN_USE',
      'INVALID_TRANSITION',
      'PERIOD_LOCKED',
      'CREDIT_LIMIT_EXCEEDED',
      // raised by the framework (malformed body, unknown method, throttling, dependency down)
      'BAD_REQUEST',
      'METHOD_NOT_ALLOWED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'RATE_LIMITED',
      'SERVICE_UNAVAILABLE',
    ]) {
      expect(ERROR_CODES, code).toContain(code);
    }
  });

  it('exposes an enum object usable as a value', () => {
    expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
  });
});

describe('problemSchema (RFC 9457)', () => {
  it('parses a validation problem with field errors', () => {
    const problem = {
      type: 'https://ekaro.in/problems/validation-failed',
      title: 'Validation failed',
      status: 422,
      detail: 'The request has 1 invalid field',
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'addresses.0.pincode', message: 'Invalid pincode', code: 'invalid_format' }],
      requestId: 'req-1',
    };
    expect(problemSchema.parse(problem)).toEqual(problem);
  });

  it('requires type, title, status and a known code', () => {
    expect(
      problemSchema.safeParse({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
      }).success,
    ).toBe(true);
    expect(
      pathsOf(
        problemSchema.safeParse({ type: 'about:blank', title: 'x', status: 404, code: 'NOPE' }),
      ),
    ).toEqual(['code']);
    expect(
      pathsOf(
        problemSchema.safeParse({
          type: 'about:blank',
          title: 'x',
          status: 200,
          code: 'NOT_FOUND',
        }),
      ),
    ).toEqual(['status']);
  });
});
