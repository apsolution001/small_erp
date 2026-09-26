import { meResponseSchema } from '@ekaro/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { meResponse, problem, tokenResponse } from '@/test/fixtures';
import { deferred, json, mockFetch, noContent, problemResponse } from '@/test/mock-fetch';
import { ApiClient, type RefreshLock, type SessionEvent } from './api-client';
import { ApiError } from './api-error';

function setup(options: { lock?: RefreshLock } = {}) {
  const server = mockFetch();
  const api = new ApiClient({
    baseUrl: `${server.baseUrl}/`,
    fetch: server.fetch,
    lock: options.lock,
  });
  const events: SessionEvent[] = [];
  api.onSessionEvent((e) => events.push(e));
  return { server, api, events };
}

const expired = () => problemResponse(problem(401, 'TOKEN_EXPIRED'));

describe('ApiClient requests', () => {
  it('sends the bearer token and cookies, and parses the body with the contract', async () => {
    const { server, api } = setup();
    server.on('GET /auth/me', () => json(200, meResponse()));
    api.setAccessToken('access-1');

    const me = await api.get('/auth/me', meResponseSchema);

    expect(me.user.email).toBe('owner@example.com');
    const [call] = server.calls;
    expect(call?.url).toBe('http://api.test/api/v1/auth/me');
    expect(call?.headers.get('Authorization')).toBe('Bearer access-1');
    expect(call?.credentials).toBe('include');
  });

  it('sends JSON bodies and query strings without undefined values', async () => {
    const { server, api } = setup();
    server.on('POST /things', () => json(201, { id: 7 }));
    const result = await api.post('/things', z.object({ id: z.number() }), {
      body: { name: 'Bolt' },
      query: { page: 2, q: 'bo lt', sort: undefined, active: true },
      auth: false,
    });
    expect(result).toEqual({ id: 7 });
    const [call] = server.calls;
    expect(call?.url).toBe('http://api.test/api/v1/things?page=2&q=bo+lt&active=true');
    expect(call?.headers.get('Content-Type')).toBe('application/json');
    expect(call?.headers.has('Authorization')).toBe(false);
    expect(call?.body).toEqual({ name: 'Bolt' });
  });

  it('accepts 204 through send()', async () => {
    const { server, api } = setup();
    server.on('POST /auth/logout', () => noContent());
    await expect(api.send('POST', '/auth/logout', { auth: false })).resolves.toBeUndefined();
  });
});

describe('ApiClient errors', () => {
  it('maps a problem document to ApiError with code, status and field errors', async () => {
    const { server, api } = setup();
    server.on('POST /auth/signup', () =>
      problemResponse(
        problem(422, 'VALIDATION_FAILED', {
          detail: 'Some fields are invalid.',
          requestId: 'req-1',
          errors: [
            { path: 'password', message: 'This password is too common', code: 'too_common' },
            { path: 'password', message: 'second message is ignored' },
            { path: 'addresses.0.pincode', message: 'Invalid pincode' },
          ],
        }),
      ),
    );

    const error = await api
      .post('/auth/signup', z.unknown(), { body: {}, auth: false })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Some fields are invalid.',
      requestId: 'req-1',
      fieldErrors: {
        password: 'This password is too common',
        'addresses.0.pincode': 'Invalid pincode',
      },
    });
  });

  it('uses its own words for rate limits and internal errors, keeping the request id', async () => {
    const { server, api } = setup();
    server.on('POST /auth/login', () =>
      problemResponse(
        problem(429, 'RATE_LIMITED', {
          detail: 'ThrottlerException: Too Many Requests',
          requestId: 'req-9',
        }),
      ),
    );
    await expect(api.post('/auth/login', z.unknown(), { auth: false })).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Wait a minute and try again.',
      requestId: 'req-9',
    });
  });

  it('falls back to the status when the body is not a problem', async () => {
    const { server, api } = setup();
    server.on('GET /a', () => new Response('<html>Bad gateway</html>', { status: 502 }));
    server.on('GET /b', () => json(404, { message: 'nope' }));
    await expect(api.get('/a', z.unknown(), { auth: false })).rejects.toMatchObject({
      status: 502,
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(api.get('/b', z.unknown(), { auth: false })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('reports a network failure as NETWORK_ERROR with status 0', async () => {
    const { server, api } = setup();
    server.on('GET /a', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.get('/a', z.unknown(), { auth: false })).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('fails loudly when a response breaks the contract', async () => {
    const { server, api } = setup();
    server.on('GET /auth/me', () => json(200, { ...meResponse(), permissions: ['nope:view'] }));
    await expect(api.get('/auth/me', meResponseSchema, { auth: false })).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
      message: 'The server sent an unexpected response (contract mismatch at permissions.0).',
    });
  });
});

describe('ApiClient silent refresh', () => {
  it('on 401 refreshes the session once and retries with the new token', async () => {
    const { server, api, events } = setup();
    api.setAccessToken('stale');
    server.on('GET /auth/me', expired, () => json(200, meResponse()));
    server.on('POST /auth/refresh', () => json(200, tokenResponse('fresh')));

    const me = await api.get('/auth/me', meResponseSchema);

    expect(me.permissions.length).toBeGreaterThan(0);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /auth/me',
      'POST /auth/refresh',
      'GET /auth/me',
    ]);
    const [, refresh, retry] = server.calls;
    expect(refresh?.credentials).toBe('include');
    expect(refresh?.headers.has('Authorization')).toBe(false);
    expect(retry?.headers.get('Authorization')).toBe('Bearer fresh');
    expect(api.getAccessToken()).toBe('fresh');
    expect(events).toEqual([{ type: 'refreshed', session: tokenResponse('fresh') }]);
  });

  it('runs a single refresh for concurrent 401s (the API ends the session on a reused cookie)', async () => {
    const { server, api } = setup();
    api.setAccessToken('stale');
    const refreshReply = deferred<Response>();
    server.on('GET /a', expired, () => json(200, { a: 1 }));
    server.on('GET /b', expired, () => json(200, { b: 2 }));
    server.on('GET /c', expired, () => json(200, { c: 3 }));
    server.on('POST /auth/refresh', () => refreshReply.promise);

    const pending = Promise.all([
      api.get('/a', z.object({ a: z.number() })),
      api.get('/b', z.object({ b: z.number() })),
      api.get('/c', z.object({ c: z.number() })),
    ]);
    await vi.waitFor(() => {
      expect(server.callsTo('POST /auth/refresh')).toHaveLength(1);
    });
    refreshReply.resolve(json(200, tokenResponse('fresh')));

    await expect(pending).resolves.toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(server.callsTo('POST /auth/refresh')).toHaveLength(1);
    for (const route of ['GET /a', 'GET /b', 'GET /c']) {
      expect(server.callsTo(route).at(-1)?.headers.get('Authorization')).toBe('Bearer fresh');
    }
  });

  it('does not refresh again when another request already replaced the token', async () => {
    const { server, api } = setup();
    api.setAccessToken('stale');
    server.on(
      'GET /a',
      () => {
        api.setAccessToken('fresh'); // another request's refresh finished meanwhile
        return expired();
      },
      () => json(200, {}),
    );

    await api.get('/a', z.object({}));

    expect(server.callsTo('GET /a')[0]?.headers.get('Authorization')).toBe('Bearer stale');
    expect(server.callsTo('POST /auth/refresh')).toHaveLength(0);
    expect(server.callsTo('GET /a').at(-1)?.headers.get('Authorization')).toBe('Bearer fresh');
  });

  it('retries only once: a second 401 is returned to the caller', async () => {
    const { server, api } = setup();
    api.setAccessToken('stale');
    server.on('GET /a', () =>
      problemResponse(problem(401, 'UNAUTHENTICATED', { detail: 'Sign in to continue.' })),
    );
    server.on('POST /auth/refresh', () => json(200, tokenResponse('fresh')));

    await expect(api.get('/a', z.unknown())).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(server.callsTo('GET /a')).toHaveLength(2);
    expect(server.callsTo('POST /auth/refresh')).toHaveLength(1);
  });

  it('ends the session when the refresh is refused: token cleared, expired event, no retry', async () => {
    const { server, api, events } = setup();
    api.setAccessToken('stale');
    server.on('GET /a', expired);
    server.on('POST /auth/refresh', () =>
      problemResponse(problem(401, 'REFRESH_REUSED', { detail: 'Sign in again.' })),
    );

    await expect(api.get('/a', z.unknown())).rejects.toMatchObject({
      status: 401,
      code: 'REFRESH_REUSED',
    });
    expect(server.callsTo('GET /a')).toHaveLength(1);
    expect(api.getAccessToken()).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'expired', error: { code: 'REFRESH_REUSED' } });
  });

  it('keeps the session when the refresh only failed on the network', async () => {
    const { server, api, events } = setup();
    api.setAccessToken('stale');
    server.on('POST /auth/refresh', () => Promise.reject(new TypeError('offline')));
    await expect(api.refreshSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(api.getAccessToken()).toBe('stale');
    expect(events).toEqual([]);
  });

  it('takes the cross-tab lock around the refresh', async () => {
    const order: string[] = [];
    const lock: RefreshLock = {
      async request(name, callback) {
        order.push(`lock ${name}`);
        const result = await callback();
        order.push('unlock');
        return result;
      },
    };
    const { server, api } = setup({ lock });
    server.on('POST /auth/refresh', () => {
      order.push('refresh');
      return json(200, tokenResponse('fresh'));
    });
    await api.refreshSession();
    expect(order).toEqual(['lock ekaro.auth.refresh', 'refresh', 'unlock']);
  });
});
