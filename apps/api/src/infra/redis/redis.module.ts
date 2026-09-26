import { Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { type Env } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';

/** Shared Redis client (cache, throttling, permission cache). BullMQ opens its own connections. */
export const REDIS = Symbol('REDIS');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') return;
    await this.redis.quit();
  }
}

@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        const logger = new Logger('Redis');
        const redis = new Redis(env.REDIS_URL, {
          connectionName: 'ekaro-api',
          // Fail commands fast while disconnected instead of queueing them indefinitely.
          maxRetriesPerRequest: 2,
          connectTimeout: 5_000,
        });
        redis.on('error', (err: Error) => {
          logger.warn({ err }, 'Redis connection error');
        });
        return redis;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
