import { type ExtractTablesWithRelations } from 'drizzle-orm';
import { type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { type PgDatabase, type PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';

type Relations = ExtractTablesWithRelations<typeof schema>;

/**
 * A Drizzle client or transaction on either connection (`ekaro_app` or `ekaro_platform`).
 *
 * A module that owns tables exposes the queries and seeds that platform code needs as functions
 * taking a `DbExecutor` (ADR 0015). The caller chooses the connection (signup bootstrap and login
 * use the platform one); the owning module still writes the SQL for its own tables.
 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema, Relations>;

/** A transaction on either connection, for work that must run inside one (`set_config(..., true)`). */
export type DbTransaction = PgTransaction<NodePgQueryResultHKT, typeof schema, Relations>;
