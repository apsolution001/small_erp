import { Logger } from '@nestjs/common';
import pg from 'pg';

export interface PoolSettings {
  readonly connectionString: string;
  readonly max: number;
  /** Shows up in pg_stat_activity, so each role's connections are identifiable. */
  readonly applicationName: string;
}

/** A node-postgres pool whose idle-client errors are logged instead of crashing the process. */
export function createPgPool(settings: PoolSettings): pg.Pool {
  const pool = new pg.Pool({
    connectionString: settings.connectionString,
    max: settings.max,
    application_name: settings.applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const logger = new Logger(settings.applicationName);
  pool.on('error', (err) => {
    logger.error({ err }, 'Idle database client error');
  });
  return pool;
}
