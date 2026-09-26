import { type z } from 'zod';

/**
 * Errors the application throws on purpose. Each carries a stable SCREAMING_SNAKE `code`
 * (the web maps codes to messages) and a client-safe `message` (rendered as `detail`).
 * `ProblemDetailsFilter` renders them as RFC 9457 problem+json.
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;

  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** One invalid input field. `path` is dotted (`lines.0.qty`); empty for the whole payload. */
export interface FieldError {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

/** 400: the input does not match the contract. Thrown by `ZodValidationPipe`. */
export class ValidationError extends DomainError {
  readonly status = 400;

  constructor(
    readonly errors: readonly FieldError[],
    message = 'The request is invalid.',
  ) {
    super('VALIDATION_FAILED', message);
  }

  /** One field error per Zod issue, with the dotted path and Zod's issue code. */
  static fromZod(error: z.core.$ZodError): ValidationError {
    return new ValidationError(
      error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
}

/** 401: no valid session. */
export class UnauthorizedError extends DomainError {
  readonly status = 401;
}

/** 403: authenticated, but not allowed. */
export class ForbiddenError extends DomainError {
  readonly status = 403;
}

/** 404: the resource does not exist (or is invisible to this tenant). */
export class NotFoundError extends DomainError {
  readonly status = 404;
}

/** 409: a conflict with current state (duplicate key, stale `version`, illegal transition). */
export class ConflictError extends DomainError {
  readonly status = 409;
}

/** 422: the input is well-formed but violates a business rule. */
export class BusinessRuleError extends DomainError {
  readonly status = 422;
}

/** 503: a dependency (database, Redis, GSP) is unavailable. */
export class ServiceUnavailableError extends DomainError {
  readonly status = 503;
}
