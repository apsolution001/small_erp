import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';
/** `apps/api/db/migrations`, from both `src/infra/db` (tsx) and `dist/infra/db` (built). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

/** Serialises concurrent runners (several API replicas or CI jobs) on one database. */
const MIGRATION_LOCK_KEY = 'ekaro:migrations';

/**
 * Applies pending migrations as `ekaro_owner` (ADR 0004). Each migration runs once, recorded in
 * `drizzle.__drizzle_migrations`; re-running is a no-op.
 */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl, application_name: 'ekaro-migrate' });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
  } finally {
    await client.end();
  }
}
