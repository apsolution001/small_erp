import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

type Reply = Response | Promise<Response> | (() => Response | Promise<Response>);
type Handler = (call: RecordedCall) => Reply;

export function json(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

export function problemResponse(body: { status: number }): Response {
  return json(body.status, body, 'application/problem+json');
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * A fetch double routed by `METHOD /path` (path relative to the API base URL). Each route takes
 * a queue of replies (the last one repeats), and every call is recorded for assertions.
 */
export function mockFetch(baseUrl = 'http://api.test/api/v1') {
  const routes = new Map<string, Handler[]>();
  const calls: RecordedCall[] = [];

  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? 'GET';
    const path = url.slice(baseUrl.length).split('?')[0] ?? '';
    const rawBody = init?.body;
    const call: RecordedCall = {
      method,
      url,
      path,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
      body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as unknown) : undefined,
    };
    calls.push(call);
    const queue = routes.get(`${method} ${path}`);
    const handler = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!handler) throw new Error(`Unmocked request ${method} ${path}`);
    const reply = handler(call);
    return typeof reply === 'function' ? reply() : reply;
  });

  return {
    baseUrl,
    fetch: fetchImpl,
    calls,
    /** Replies in order; the last reply repeats for later calls. */
    on(route: string, ...handlers: Handler[]) {
      routes.set(route, handlers);
      return this;
    },
    callsTo(route: string) {
      return calls.filter((c) => `${c.method} ${c.path}` === route);
    },
  };
}

/** A promise you resolve by hand, to hold a response while other calls race. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
