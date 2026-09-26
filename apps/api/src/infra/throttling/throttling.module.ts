import { type ExecutionContext, Module } from '@nestjs/common';
import { SkipThrottle, ThrottlerModule } from '@nestjs/throttler';
import { type Redis } from 'ioredis';
import { type Env } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { REDIS, RedisModule } from '../redis/redis.module.js';
import { rateLimitSubject } from './client-ip.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

const MINUTE_MS = 60_000;

/** Named throttlers. A throttled controller applies `ThrottlerGuard` and skips the others. */
export const THROTTLERS = {
  /** Per client IP, on each auth route. */
  authIp: 'auth-ip',
  /** Per email address, on login and signup. */
  authAccount: 'auth-account',
  /** Per client IP, on the public GSTIN lookup. */
  gstinIp: 'gstin-ip',
} as const;

/**
 * The client IP as Express resolved it with `trust proxy` (TRUST_PROXY_HOPS), as a rate-limit
 * subject: IPv4 as is (also IPv4-mapped), IPv6 by its /64.
 */
function clientIp(req: Record<string, unknown>): string {
  return rateLimitSubject(typeof req.ip === 'string' ? req.ip : undefined);
}

/** The email the request is about (login, signup), normalised like the contracts schema does. */
export function accountOf(req: Record<string, unknown>): string | undefined {
  const body = req.body;
  if (typeof body !== 'object' || body === null || !('email' in body)) return undefined;
  const email: unknown = body.email;
  return typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : undefined;
}

const hasAccount = (context: ExecutionContext): boolean =>
  accountOf(context.switchToHttp().getRequest<Record<string, unknown>>()) !== undefined;

/** For the auth controller: per IP and per account, not the GSTIN limit. */
export const AuthThrottles = (): MethodDecorator & ClassDecorator =>
  SkipThrottle({ [THROTTLERS.gstinIp]: true });

/** For the GSTIN lookup: only the GSTIN limit. */
export const GstinThrottles = (): MethodDecorator & ClassDecorator =>
  SkipThrottle({ [THROTTLERS.authIp]: true, [THROTTLERS.authAccount]: true });

/**
 * Rate limits on the public auth surface (security standard), counted in Redis. The guard is not
 * global: controllers opt in with `@UseGuards(ThrottlerGuard)` and one of the decorators above.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [
          {
            name: THROTTLERS.authIp,
            ttl: MINUTE_MS,
            limit: env.THROTTLE_AUTH_PER_MINUTE,
            getTracker: clientIp,
          },
          {
            name: THROTTLERS.authAccount,
            ttl: MINUTE_MS,
            limit: env.THROTTLE_ACCOUNT_PER_MINUTE,
            getTracker: (req: Record<string, unknown>) => accountOf(req) ?? clientIp(req),
            skipIf: (context: ExecutionContext) => !hasAccount(context),
          },
          {
            name: THROTTLERS.gstinIp,
            ttl: MINUTE_MS,
            limit: env.THROTTLE_GSTIN_PER_MINUTE,
            getTracker: clientIp,
          },
        ],
      }),
    }),
  ],
})
export class ThrottlingModule {}
