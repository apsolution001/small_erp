import { type ErrorCode, type Problem, problemSchema } from '@ekaro/contracts';

/**
 * Codes the client adds to the API's catalogue: the request never got an HTTP answer, or the
 * answer broke the contract (fail loudly on drift, frontend standard).
 */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

interface ApiErrorInit {
  status: number;
  code: ApiErrorCode;
  message: string;
  fieldErrors?: Readonly<Record<string, string>>;
  requestId?: string | undefined;
  cause?: unknown;
}

/** Every failed API call surfaces as an ApiError: code, HTTP status and per-field messages. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** HTTP status; 0 when no response arrived. */
  readonly status: number;
  readonly code: ApiErrorCode;
  /**
   * Server validation messages keyed by field path (`addresses.0.pincode`, as react-hook-form
   * names fields). The first message per path wins.
   */
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly requestId: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? {};
    this.requestId = init.requestId;
  }

  static fromProblem(problem: Problem): ApiError {
    const fieldErrors: Record<string, string> = {};
    for (const { path, message } of problem.errors ?? []) {
      fieldErrors[path] ??= message;
    }
    return new ApiError({
      status: problem.status,
      code: problem.code,
      message: GENERIC_MESSAGES[problem.code] ?? problem.detail ?? problem.title,
      fieldErrors,
      requestId: problem.requestId,
    });
  }

  /** An error answer that is not a problem document (a proxy page, an empty body). */
  static fromStatus(status: number): ApiError {
    return new ApiError({ status, code: codeForStatus(status), message: messageForStatus(status) });
  }

  static network(cause: unknown): ApiError {
    return new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach Ekaro. Check your internet connection and try again.',
      cause,
    });
  }

  static invalidResponse(status: number, detail: string, cause?: unknown): ApiError {
    return new ApiError({
      status,
      code: 'INVALID_RESPONSE',
      message: `The server sent an unexpected response (${detail}).`,
      cause,
    });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Parses an error body: a problem document when it is one, otherwise the status decides. */
export function toApiError(status: number, body: unknown): ApiError {
  const parsed = problemSchema.safeParse(body);
  return parsed.success ? ApiError.fromProblem(parsed.data) : ApiError.fromStatus(status);
}

/**
 * Codes whose server detail is technical (framework text, internals) rather than written for
 * the user: the web says it in its own words.
 */
const RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a minute and try again.';
const SERVER_TROUBLE_MESSAGE = 'Ekaro is having trouble right now. Try again in a few minutes.';
const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  RATE_LIMITED: RATE_LIMITED_MESSAGE,
  INTERNAL_ERROR: SERVER_TROUBLE_MESSAGE,
};

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    case 502:
    case 503:
    case 504:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

function messageForStatus(status: number): string {
  if (status === 429) return RATE_LIMITED_MESSAGE;
  if (status >= 500) return SERVER_TROUBLE_MESSAGE;
  return `The request failed (HTTP ${String(status)}).`;
}

/** A message fit for a toast or a form alert, for any thrown value. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return 'Something went wrong. Try again.';
}
