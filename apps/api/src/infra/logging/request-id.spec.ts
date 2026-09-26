import { describe, expect, it, vi } from 'vitest';
import { REQUEST_ID_HEADER, requestIdMiddleware, resolveRequestId } from './request-id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a well-formed inbound id (proxies and load balancers set one)', () => {
    expect(resolveRequestId('01J9Z3-abc_def.1:2')).toBe('01J9Z3-abc_def.1:2');
    expect(resolveRequestId('Root=1-67891233-abcdef012345678912345678')).toBe(
      'Root=1-67891233-abcdef012345678912345678',
    );
  });

  it('generates a UUIDv7 when the header is missing, repeated, too long or unsafe', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID_V7);
    expect(resolveRequestId(['a', 'b'])).toMatch(UUID_V7);
    expect(resolveRequestId('')).toMatch(UUID_V7);
    expect(resolveRequestId('x'.repeat(129))).toMatch(UUID_V7);
    expect(resolveRequestId('abc\ninjected log line')).toMatch(UUID_V7);
    expect(resolveRequestId('<script>')).toMatch(UUID_V7);
  });
});

describe('requestIdMiddleware', () => {
  it('sets req.id and echoes it in the response header', () => {
    const req = { headers: { [REQUEST_ID_HEADER]: 'abc-123' } } as unknown as Parameters<
      typeof requestIdMiddleware
    >[0];
    const setHeader = vi.fn();
    const next = vi.fn();
    requestIdMiddleware(
      req,
      { setHeader } as unknown as Parameters<typeof requestIdMiddleware>[1],
      next,
    );
    expect(req.id).toBe('abc-123');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'abc-123');
    expect(next).toHaveBeenCalledOnce();
  });
});
