import { type TokenResponse, tokenResponseSchema } from '@ekaro/contracts';
import { type z } from 'zod';
import { ApiError, toApiError } from './api-error';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  body?: unknown;
  query?: Readonly<Record<string, QueryValue>>;
  /**
   * Default true: send the access token, and on a 401 refresh the session once and retry.
   * The auth endpoints that do not need a session (login, signup, refresh) pass false.
   */
  auth?: boolean;
  signal?: AbortSignal;
}

/** What the client tells the auth layer about the session it holds. */
export type SessionEvent =
  | { type: 'refreshed'; session: TokenResponse }
  /** The refresh token was refused: the user must sign in again. */
  | { type: 'expired'; error: ApiError };

/** The subset of the Web Locks API the client uses (lets tests pass a fake). */
export interface RefreshLock {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface ApiClientOptions {
  /** e.g. `/api/v1` (same origin, through the dev proxy) or `http://localhost:3000/api/v1`. */
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Serialises refreshes across browser tabs. The API revokes the whole session when one
   * refresh cookie is presented twice (ADR 0015), so two tabs must never refresh at once.
   * Defaults to `navigator.locks` when the browser has it.
   */
  lock?: RefreshLock | undefined;
}

const REFRESH_LOCK = 'ekaro.auth.refresh';

function defaultLock(): RefreshLock | undefined {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return undefined;
  const { locks } = navigator;
  return { request: (name, callback) => locks.request(name, callback) };
}

/**
 * The one typed HTTP client (frontend standard). Every response is parsed with its contracts
 * schema, every error becomes an {@link ApiError}, and the access token lives in memory only.
 * The refresh token is the httpOnly cookie, sent because every call includes credentials.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly lock: RefreshLock | undefined;
  private accessToken: string | null = null;
  private refreshInFlight: Promise<TokenResponse> | null = null;
  private readonly listeners = new Set<(event: SessionEvent) => void>();

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // Bound: a bare `fetch` reference called as a method throws "Illegal invocation".
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.lock = 'lock' in options ? options.lock : defaultLock();
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  onSessionEvent(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) {
    return this.request('GET', path, schema, options);
  }

  post<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) {
    return this.request('POST', path, schema, options);
  }

  put<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) {
    return this.request('PUT', path, schema, options);
  }

  patch<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) {
    return this.request('PATCH', path, schema, options);
  }

  delete<S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) {
    return this.request('DELETE', path, schema, options);
  }

  /** For endpoints that answer 204 No Content. */
  async send(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<void> {
    await this.exchange(method, path, options);
  }

  async request<S extends z.ZodType>(
    method: HttpMethod,
    path: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<z.output<S>> {
    const response = await this.exchange(method, path, options);
    return parseBody(response, schema);
  }

  /**
   * Rotates the refresh cookie and stores the new access token. Single flight: concurrent
   * callers share one request, and tabs take turns through the lock.
   */
  refreshSession(): Promise<TokenResponse> {
    this.refreshInFlight ??= this.runRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async runRefresh(): Promise<TokenResponse> {
    const refresh = async () => {
      const response = await this.fetchOnce('POST', '/auth/refresh', {}, null);
      if (!response.ok) throw await errorOf(response);
      return parseBody(response, tokenResponseSchema);
    };
    try {
      const session = await (this.lock ? this.lock.request(REFRESH_LOCK, refresh) : refresh());
      this.accessToken = session.accessToken;
      this.emit({ type: 'refreshed', session });
      return session;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : ApiError.network(error);
      // A network failure is not a verdict on the session; anything else ends it.
      if (apiError.code !== 'NETWORK_ERROR') {
        this.accessToken = null;
        this.emit({ type: 'expired', error: apiError });
      }
      throw apiError;
    }
  }

  private async exchange(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<Response> {
    const useSession = options.auth ?? true;
    const token = useSession ? this.accessToken : null;
    let response = await this.fetchOnce(method, path, options, token);
    if (response.status === 401 && useSession) {
      // Another request may have refreshed while this one was in flight: reuse its token.
      if (this.accessToken === null || this.accessToken === token) await this.refreshSession();
      response = await this.fetchOnce(method, path, options, this.accessToken);
    }
    if (!response.ok) throw await errorOf(response);
    return response;
  }

  private async fetchOnce(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    token: string | null,
  ): Promise<Response> {
    const headers = new Headers({ Accept: 'application/json, application/problem+json' });
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    const init: RequestInit = { method, headers, credentials: 'include' };
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(options.body);
    }
    if (options.signal) init.signal = options.signal;
    try {
      return await this.fetchFn(this.url(path, options.query), init);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw ApiError.network(error);
    }
  }

  private url(path: string, query: RequestOptions['query']): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const search = params.toString();
    return `${this.baseUrl}${path}${search === '' ? '' : `?${search}`}`;
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw ApiError.invalidResponse(response.status, 'body is not JSON', error);
  }
}

async function errorOf(response: Response): Promise<ApiError> {
  try {
    return toApiError(response.status, await readJson(response));
  } catch {
    return ApiError.fromStatus(response.status);
  }
}

async function parseBody<S extends z.ZodType>(response: Response, schema: S): Promise<z.output<S>> {
  const body = await readJson(response);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw ApiError.invalidResponse(response.status, `contract mismatch at ${paths}`, parsed.error);
  }
  return parsed.data;
}
