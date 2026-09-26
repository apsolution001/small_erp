import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { DB_CASING } from './casing.js';
import * as schema from './schema.js';

/**
 * The platform connection (role `ekaro_platform`, no BYPASSRLS): tenants, users, refresh tokens,
 * plus `platform_read` policies on the few tenant tables login needs (ADR 0003).
 * Only modules/platform and modules/auth may import this file (ESLint boundary rule).
 */
export const PLATFORM_POOL = Symbol('PLATFORM_POOL');
export const PLATFORM_DB = Symbol('PLATFORM_DB');

export type PlatformDb = NodePgDatabase<typeof schema>;

export function createPlatformDb(pool: pg.Pool): PlatformDb {
  return drizzle({ client: pool, schema, casing: DB_CASING });
}
