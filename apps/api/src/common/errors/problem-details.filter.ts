import { STATUS_CODES } from 'node:http';
import { type ErrorCode, type Problem } from '@ekaro/contracts';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { z } from 'zod';
import { isUniqueViolation } from '../../infra/db/pg-errors.js';
import { serializeError } from '../../infra/logging/error-serializer.js';
import { DomainError, type FieldError, ValidationError } from './domain-error.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * RFC 9457 problem details, as `problemSchema` in `@ekaro/contracts` describes them. `type` is
 * always `about:blank` (so `title` is the HTTP status phrase); the machine-readable identity of
 * the problem is the stable `code` extension.
 */
export interface ProblemDetails extends Problem {
  type: 'about:blank';
  detail: string;
  errors?: FieldError[];
}

const GENERIC_DETAIL = 'An unexpected error occurred.';

/** Codes for framework-raised HTTP errors (unknown route, throttling, body too large...). */
const HTTP_CODES: Readonly<Partial<Record<number, ErrorCode>>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'BUSINESS_RULE_VIOLATION',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

function problem(
  status: number,
  code: ErrorCode,
  detail: string,
  errors?: readonly FieldError[],
): ProblemDetails {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    detail,
    ...(errors === undefined ? {} : { errors: [...errors] }),
  };
}

function httpExceptionDetail(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return exception.message;
}

/** Maps anything thrown to a client-safe problem. Pure: no logging, no I/O. */
export function toProblemDetails(exception: unknown): ProblemDetails {
  if (exception instanceof ValidationError) {
    return problem(exception.status, exception.code, exception.message, exception.errors);
  }
  if (exception instanceof DomainError) {
    return problem(exception.status, exception.code, exception.message);
  }
  if (exception instanceof z.core.$ZodError) {
    const validation = ValidationError.fromZod(exception);
    return problem(validation.status, validation.code, validation.message, validation.errors);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return problem(status, 'INTERNAL_ERROR', GENERIC_DETAIL);
    // Any other 4xx the framework raises is still a client error with a catalogue code.
    return problem(status, HTTP_CODES[status] ?? 'BAD_REQUEST', httpExceptionDetail(exception));
  }
  if (isUniqueViolation(exception)) {
    return problem(
      HttpStatus.CONFLICT,
      'ALREADY_EXISTS',
      'A record with the same unique value already exists.',
    );
  }
  return problem(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', GENERIC_DETAIL);
}

interface HttpResponseLike {
  headersSent: boolean;
  status(code: number): HttpResponseLike;
  setHeader(name: string, value: string): unknown;
  send(body: string): unknown;
}

/** Global filter: every HTTP error leaves the API as `application/problem+json`. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toProblemDetails(exception);
    if (body.status >= 500) {
      // Never the raw error: a failed query carries its SQL and parameters (security standard).
      this.logger.error({ err: serializeError(exception) }, 'Unhandled error');
    }

    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponseLike>();
    if (response.headersSent) return;

    const requestId = http.getRequest<{ id?: unknown }>().id;
    if (typeof requestId === 'string') body.requestId = requestId;

    response
      .status(body.status)
      .setHeader('Content-Type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
    response.send(JSON.stringify(body));
  }
}
