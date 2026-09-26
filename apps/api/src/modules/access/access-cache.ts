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
 * Redis cache of {@link AccessSnapshot}s: one hash per tenant, one field per membership, each
 * entry valid for 60 seconds. The invalidation hooks drop one membership (its role, branches or
 * status changed) or the whole tenant (a role's permissions changed). A Redis failure on read or
 * write only costs a database load; it never fails the request.
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
      raw = await this.redis.hget(keyOf(tenantId), membershipId);
    } catch (err) {
      this.logger.warn({ err }, 'Access cache read failed');
      return undefined;
    }
    if (raw === null) return undefined;
    const entry = parseEntry(raw);
    if (entry === undefined || entry.expiresAt <= this.clock.now().getTime()) return undefined;
    return entry.snapshot;
  }

  async set(snapshot: AccessSnapshot): Promise<void> {
    const key = keyOf(snapshot.tenantId);
    const expiresAt = this.clock.now().getTime() + ACCESS_CACHE_TTL_SECONDS * 1000;
    try {
      await this.redis
        .multi()
        .hset(key, snapshot.membershipId, JSON.stringify({ expiresAt, snapshot }))
        .expire(key, ACCESS_CACHE_TTL_SECONDS)
        .exec();
    } catch (err) {
      this.logger.warn({ err }, 'Access cache write failed');
    }
  }

  /** Call after a membership's role, branch scope or status changes (and on user disable). */
  async invalidateMembership(tenantId: string, membershipId: string): Promise<void> {
    await this.redis.hdel(keyOf(tenantId), membershipId);
  }

  /** Call after a role's permissions change, or the tenant's status changes. */
  async invalidateTenant(tenantId: string): Promise<void> {
    await this.redis.del(keyOf(tenantId));
  }
}

function keyOf(tenantId: string): string {
  return `${KEY_PREFIX}${tenantId}`;
}

function parseEntry(raw: string): z.infer<typeof entrySchema> | undefined {
  try {
    const parsed = entrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
