import { type IncomingMessage, type ServerResponse } from 'node:http';
import { uuidv7 } from '@ekaro/core';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Printable, log-safe ids only (no whitespace or markup); length-capped. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:=-]{1,128}$/;

/** The inbound `x-request-id` when it is safe to log and store, otherwise a new UUIDv7. */
export function resolveRequestId(header: string | string[] | undefined): string {
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : uuidv7();
}

/**
 * First middleware of the app: fixes `req.id` once, so the Pino request logger, the CLS context,
 * `app.request_id` (audit rows) and problem responses all carry the same id.
 */
export function requestIdMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/** `req.id` as set by {@link requestIdMiddleware} (a fresh id if it did not run). */
export function requestIdOf(req: IncomingMessage): string {
  return typeof req.id === 'string' ? req.id : resolveRequestId(undefined);
}
