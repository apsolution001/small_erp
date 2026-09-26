import { Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../../infra/clock/clock.js';
import { AccessCache } from './access-cache.js';

/** A Redis whose every command fails, as during an outage. */
function downRedis(): Redis {
  const down = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
  const pipeline = {
    incr: () => pipeline,
    expire: () => pipeline,
    hdel: () => pipeline,
    del: () => pipeline,
    exec: down,
  };
  const redis = { multi: () => pipeline, get: down, hget: down, eval: down };
  return redis as unknown as Redis;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccessCache when Redis is down', () => {
  it('never throws from the invalidation hooks, and logs the failure', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const cache = new AccessCache(downRedis(), new Clock());
    await expect(cache.invalidateMembership('t-1', 'm-1')).resolves.toBeUndefined();
    await expect(cache.invalidateTenant('t-1')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1' }),
      'Access cache invalidation failed',
    );
  });

  it('falls back to the loader and caches nothing', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const cache = new AccessCache(downRedis(), new Clock());
    const load = vi.fn(() => Promise.resolve(undefined));
    await expect(cache.getOrLoad('t-1', 'm-1', load)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledOnce();
    expect(await cache.generation('t-1')).toBeUndefined();
  });
});
