import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type TenantContext } from './tenant-context.js';
import { TenantTxInterceptor } from './tenant-tx.interceptor.js';

function fakeTenantContext(tenantId: string | undefined) {
  const events: string[] = [];
  const context = {
    tenantId,
    inTenantTransaction: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
      events.push('begin');
      try {
        const result = await fn();
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    }),
  };
  return { context, events, tenantContext: context as unknown as TenantContext };
}

const http = { getType: () => 'http' } as ExecutionContext;
const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('TenantTxInterceptor', () => {
  it('passes requests without a tenant straight through (public and platform routes)', async () => {
    const { context, tenantContext } = fakeTenantContext(undefined);
    const result = new TenantTxInterceptor(tenantContext).intercept(http, handler('ok'));
    await expect(lastValueFrom(result)).resolves.toBe('ok');
    expect(context.inTenantTransaction).not.toHaveBeenCalled();
  });

  it('runs the handler inside a tenant transaction and commits before emitting', async () => {
    const { events, tenantContext } = fakeTenantContext('tenant-1');
    const result = new TenantTxInterceptor(tenantContext).intercept(http, {
      handle: () => {
        events.push('handler');
        return of({ id: 1 });
      },
    });
    expect(events).toEqual([]);
    await expect(lastValueFrom(result)).resolves.toEqual({ id: 1 });
    expect(events).toEqual(['begin', 'handler', 'commit']);
  });

  it('rolls back and rethrows when the handler fails', async () => {
    const { events, tenantContext } = fakeTenantContext('tenant-1');
    const boom = new Error('boom');
    const result = new TenantTxInterceptor(tenantContext).intercept(http, {
      handle: () => throwError(() => boom),
    });
    await expect(lastValueFrom(result)).rejects.toBe(boom);
    expect(events).toEqual(['begin', 'rollback']);
  });

  it('handles void handlers', async () => {
    const { tenantContext } = fakeTenantContext('tenant-1');
    const result = new TenantTxInterceptor(tenantContext).intercept(http, {
      handle: () => of(),
    });
    await expect(lastValueFrom(result, { defaultValue: 'none' })).resolves.toBeUndefined();
  });

  it('ignores non-HTTP contexts', async () => {
    const { context, tenantContext } = fakeTenantContext('tenant-1');
    const rpc = { getType: () => 'rpc' } as ExecutionContext;
    await lastValueFrom(new TenantTxInterceptor(tenantContext).intercept(rpc, handler(1)));
    expect(context.inTenantTransaction).not.toHaveBeenCalled();
  });
});
