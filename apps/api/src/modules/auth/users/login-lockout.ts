import { Inject, Injectable } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { REDIS } from '../../../infra/redis/redis.module.js';
import { type Pseudonym, Pseudonymizer } from '../security/pseudonymizer.js';

/** Progressive lockout (spec 01 §1): 5 consecutive failures lock the email for 15 minutes. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** Consecutive failures count while each comes within a day of the previous one. */
export const FAILURE_MEMORY_HOURS = 24;

const KEY_PREFIX = 'ekaro:login-lockout:';

/**
 * Counts one failure and locks on the limit, atomically. KEYS[1] = failure counter, KEYS[2] =
 * lock; ARGV = limit, lock ms, counter memory ms. Returns 1 when this failure locked the email.
 */
const RECORD_FAILURE = `
local failures = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
if failures >= tonumber(ARGV[1]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[2])
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export interface LockoutState {
  readonly failures: number;
  /** Milliseconds until the lock ends; 0 when not locked. */
  readonly lockedForMs: number;
}

/**
 * Login lockout per email address, in Redis (ADR 0016). Keyed by the email's keyed pseudonym,
 * never by the user: an unknown email locks exactly like a registered one, so the lock cannot
 * be used to find out which emails have accounts, and no email is ever stored in Redis.
 */
@Injectable()
export class LoginLockout {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly pseudonyms: Pseudonymizer,
  ) {}

  async isLocked(email: string): Promise<boolean> {
    return (await this.redis.exists(this.keys(email).lock)) === 1;
  }

  /** Counts a failed login. True when it was the one that locked the email. */
  async recordFailure(email: string): Promise<boolean> {
    const { failures, lock } = this.keys(email);
    const locked: unknown = await this.redis.eval(
      RECORD_FAILURE,
      2,
      failures,
      lock,
      MAX_FAILED_LOGINS,
      LOCKOUT_MINUTES * 60_000,
      FAILURE_MEMORY_HOURS * 3_600_000,
    );
    return locked === 1;
  }

  /** A successful login starts the count again. */
  async reset(email: string): Promise<void> {
    await this.redis.del(this.keys(email).failures);
  }

  /** Current failures and lock, for support tools and tests. */
  async state(email: string): Promise<LockoutState> {
    const { failures, lock } = this.keys(email);
    const [count, ttl] = await Promise.all([this.redis.get(failures), this.redis.pttl(lock)]);
    return { failures: count === null ? 0 : Number(count), lockedForMs: Math.max(0, ttl) };
  }

  /** Lifts a lock and forgets the failures (support unlock). */
  async clear(email: string): Promise<void> {
    const { failures, lock } = this.keys(email);
    await this.redis.del(failures, lock);
  }

  private keys(email: string): { failures: string; lock: string } {
    const id: Pseudonym = this.pseudonyms.email(email);
    return { failures: `${KEY_PREFIX}${id}:failures`, lock: `${KEY_PREFIX}${id}:lock` };
  }
}
