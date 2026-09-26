import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { type Env } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { APP_DB, APP_POOL, createAppDb } from './app-db.js';
import { createPgPool } from './pg-pool.js';
import { createPlatformDb, PLATFORM_DB, PLATFORM_POOL } from './platform-db.js';

/** Closes both pools when the app shuts down (after in-flight requests have finished). */
@Injectable()
class DbPoolsLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(APP_POOL) private readonly appPool: pg.Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: pg.Pool,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.appPool.end(), this.platformPool.end()]);
  }
}

/** The two runtime connections. The API never connects as `ekaro_owner` (migrations only). */
@Module({
  providers: [
    {
      provide: APP_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createPgPool({
          connectionString: env.DATABASE_URL_APP,
          max: env.DB_POOL_MAX,
          applicationName: 'ekaro-api-app',
        }),
    },
    {
      provide: PLATFORM_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createPgPool({
          connectionString: env.DATABASE_URL_PLATFORM,
          max: env.DB_POOL_MAX,
          applicationName: 'ekaro-api-platform',
        }),
    },
    { provide: APP_DB, inject: [APP_POOL], useFactory: createAppDb },
    { provide: PLATFORM_DB, inject: [PLATFORM_POOL], useFactory: createPlatformDb },
    DbPoolsLifecycle,
  ],
  exports: [APP_DB, PLATFORM_DB],
})
export class DbModule {}
