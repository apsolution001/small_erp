import {
  MEMBERSHIP_STATUSES,
  permissionSchema,
  TENANT_STATUSES,
  uuidSchema,
} from '@ekaro/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { z } from 'zod';
import { Clock } from '../../infra/clock/clock.js';
import { REDIS } from '../../infra/redis/redis.module.js';

/** How long a membership's access may be served from cache (ADR 0007). */
export const ACCESS_CACHE_TTL_SECONDS = 60;
/** The generation counter outlives any load by far; it is refreshed on every invalidation. */
const GENERATION_TTL_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = 'ekaro:access:';

/**
 * Everything the auth guard needs to accept a token: the membership's role, effective
 * permissions and branch scope, plus the user's and tenant's status.
 */
export const accessSnapshotSchema = z.object({
  membershipId: uuidSchema,
  tenantId: uuidSchema,
  userId: uuidSchema,
  membershipStatus: z.enum(MEMBERSHIP_STATUSES),
  userStatus: z.enum(['active', 'disabled']),
  tenantStatus: z.enum(TENANT_STATUSES),
  role: z.object({ id: uuidSchema, name: z.string(), isOwner: z.boolean() }),
  permissions: z.array(permissionSchema),
  allBranches: z.boolean(),
  branchIds: z.array(uuidSchema),
});
export type AccessSnapshot = z.infer<typeof accessSnapshotSchema>;

const entrySchema = z.object({ expiresAt: z.number(), snapshot: accessSnapshotSchema });

/**
 * Writes an entry only if the tenant's generation is still the one read before the load.
 * KEYS[1] = generation, KEYS[2] = tenant hash; ARGV = generation, field, entry, ttl seconds.
 */
const SET_IF_GENERATION = `
local current = redis.call('GET', KEYS[1]) or '0'
if current ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`;

/**
 * Redis cache of {@link AccessSnapshot}s: one hash per tenant, one field per membership, each
 * entry valid for 60 seconds (ADR 0007, ADR 0016).
 *
 * A per-tenant generation counter closes the race between a load and an invalidation: every
 * invalidation increments it, and a loader writes its entry only if the generation it read
 * before its database load is unchanged. So an entry loaded before a change committed can never
 * be written after that change's invalidation.
 *
 * A Redis failure never fails a request or a caller: reads fall back to the database, writes are
 * skipped, and a failed invalidation is logged (the entry then expires within 60 seconds).
 */
@Injectable()
export class AccessCache {
  private readonly logger = new Logger(AccessCache.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly clock: Clock,
  ) {}

  async get(tenantId: string, membershipId: string): Promise<AccessSnapshot | undefined> {
    let raw: string | null;
    try {
      raw = await this.redis.hget(keysOf(tenantId).entries, membershipId);
    } catch (err) {
      this.logger.warn({ err }, 'Access cache read failed');
      return undefined;
    }
    if (raw === null) return undefined;
    const entry = parseEntry(raw);
    if (entry === undefined || entry.expiresAt <= this.clock.now().getTime()) return undefined;
    return entry.snapshot;
  }

  /**
   * The cached snapshot, or `load()`'s result, cached unless the tenant was invalidated while it
   * ran. Only a snapshot of `tenantId` and `membershipId` is cached.
   */
  async getOrLoad(
    tenantId: string,
    membershipId: string,
    load: () => Promise<AccessSnapshot | undefined>,
  ): Promise<AccessSnapshot | undefined> {
    const hit = await this.get(tenantId, membershipId);
    if (hit !== undefined) return hit;
    const generation = await this.generation(tenantId);
    const loaded = await load();
    if (
      loaded !== undefined &&
      generation !== undefined &&
      loaded.tenantId === tenantId &&
      loaded.membershipId === membershipId
    ) {
      await this.set(loaded, generation);
    }
    return loaded;
  }

  /** The tenant's current generation; `undefined` when Redis cannot say (then do not cache). */
  async generation(tenantId: string): Promise<string | undefined> {
    try {
      return (await this.redis.get(keysOf(tenantId).generation)) ?? '0';
    } catch (err) {
      this.logger.warn({ err }, 'Access cache read failed');
      return undefined;
    }
  }

  /**
   * Caches a snapshot loaded after reading `generation`. Returns false (and writes nothing) when
   * the tenant was invalidated since, or Redis failed.
   */
  async set(snapshot: AccessSnapshot, generation: string): Promise<boolean> {
    const keys = keysOf(snapshot.tenantId);
    const expiresAt = this.clock.now().getTime() + ACCESS_CACHE_TTL_SECONDS * 1000;
    try {
      const written: unknown = await this.redis.eval(
        SET_IF_GENERATION,
        2,
        keys.generation,
        keys.entries,
        generation,
        snapshot.membershipId,
        JSON.stringify({ expiresAt, snapshot }),
        ACCESS_CACHE_TTL_SECONDS,
      );
      return written === 1;
    } catch (err) {
      this.logger.warn({ err }, 'Access cache write failed');
      return false;
    }
  }

  /**
   * Call after a membership's role, branch scope or status changes (and on user disable), after
   * the transaction commits. Never throws.
   */
  async invalidateMembership(tenantId: string, membershipId: string): Promise<void> {
    const keys = keysOf(tenantId);
    await this.invalidate(tenantId, (tx) => tx.hdel(keys.entries, membershipId));
  }

  /**
   * Call after a role's permissions change, or the tenant's status changes, after the
   * transaction commits. Never throws.
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const keys = keysOf(tenantId);
    await this.invalidate(tenantId, (tx) => tx.del(keys.entries));
  }

  private async invalidate(
    tenantId: string,
    drop: (tx: ReturnType<Redis['multi']>) => ReturnType<Redis['multi']>,
  ): Promise<void> {
    const keys = keysOf(tenantId);
    try {
      const tx = this.redis
        .multi()
        .incr(keys.generation)
        .expire(keys.generation, GENERATION_TTL_SECONDS);
      const results = await drop(tx).exec();
      const failed = results?.find(([error]) => error !== null)?.[0];
      if (results === null || failed !== undefined) {
        throw failed ?? new Error('Access cache invalidation was aborted');
      }
    } catch (err) {
      // The change is already committed: failing its caller now would help no one. The stale
      // entry expires within ACCESS_CACHE_TTL_SECONDS.
      this.logger.error({ err, tenantId }, 'Access cache invalidation failed');
    }
  }
}

/** Both keys share the `{tenantId}` hash tag, so the Lua script also runs on Redis Cluster. */
function keysOf(tenantId: string): { entries: string; generation: string } {
  return {
    entries: `${KEY_PREFIX}{${tenantId}}`,
    generation: `${KEY_PREFIX}{${tenantId}}:generation`,
  };
}

function parseEntry(raw: string): z.infer<typeof entrySchema> | undefined {
  try {
    const parsed = entrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
