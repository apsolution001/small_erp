import { type TransactionalAdapter, type TransactionHost } from '@nestjs-cls/transactional';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { type PgTransactionConfig } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { DB_CASING } from './casing.js';
import * as schema from './schema.js';

/**
 * The tenant-work connection (role `ekaro_app`, RLS enforced). Tenant code never injects it
 * directly: it goes through {@link AppTxHost}, whose transaction carries the tenant context.
 */
export const APP_POOL = Symbol('APP_POOL');
export const APP_DB = Symbol('APP_DB');

export type AppDb = NodePgDatabase<typeof schema>;

/**
 * Type of the registered `TransactionalAdapterDrizzleOrm<AppDb>`, stated through the plugin's
 * interface: the adapter class declares `defaultTxOptions` in a way that does not satisfy that
 * interface under `exactOptionalPropertyTypes`, which would make `TransactionHost#tx` `never`.
 * Same client and transaction types as the adapter (it exposes the Drizzle tx as the client type).
 */
export type AppTransactionalAdapter = TransactionalAdapter<AppDb, AppDb, PgTransactionConfig>;

/** Inject in repositories: `txHost.tx` is the current tenant transaction. */
export type AppTxHost = TransactionHost<AppTransactionalAdapter>;

export function createAppDb(pool: pg.Pool): AppDb {
  return drizzle({ client: pool, schema, casing: DB_CASING });
}
