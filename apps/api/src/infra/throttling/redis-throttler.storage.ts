import { type ThrottlerStorage } from '@nestjs/throttler';
import { type Redis } from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

export const THROTTLE_KEY_PREFIX = 'ekaro:throttle:';

/**
 * Fixed window per key, plus a block once the limit is exceeded, in one atomic round trip:
 * KEYS[1] = hit counter, KEYS[2] = block marker; ARGV = ttl ms, limit, block duration ms.
 * Returns hits, the window's remaining ms and the block's remaining ms (0 when not blocked).
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local window = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
if blocked < 0 then blocked = 0 end
return { hits, window, blocked }
`;

const toSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

function isCounts(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number');
}

/**
 * `@nestjs/throttler` storage on the shared Redis (security standard), so limits hold across API
 * replicas and restarts. Keys are namespaced per throttler.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${THROTTLE_KEY_PREFIX}${throttlerName}:${key}`;
    const result: unknown = await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration,
    );
    if (!isCounts(result)) throw new Error('Unexpected reply from the throttle script');
    const [totalHits, windowMs, blockedMs] = result;
    return {
      totalHits,
      timeToExpire: toSeconds(windowMs),
      isBlocked: blockedMs > 0,
      timeToBlockExpire: toSeconds(blockedMs),
    };
  }
}
