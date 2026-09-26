import { Inject, Injectable } from '@nestjs/common';
import { type HealthCheckAttempt, HealthIndicatorService } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { type Redis } from 'ioredis';
import { APP_DB, type AppDb } from '../db/app-db.js';
import { REDIS } from '../redis/redis.module.js';

const CHECK_TIMEOUT_MS = 2_000;

/** `select 1` on the app pool (the connection every tenant request needs). */
@Injectable()
export class DbHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(APP_DB) private readonly db: AppDb,
  ) {}

  isHealthy<const Key extends string>(key: Key): HealthCheckAttempt<Key> {
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.db.execute(sql`select 1`);
      })
      .withTimeout(CHECK_TIMEOUT_MS);
  }
}

/** `PING` on the shared Redis client. */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  isHealthy<const Key extends string>(key: Key): HealthCheckAttempt<Key> {
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout(CHECK_TIMEOUT_MS);
  }
}
