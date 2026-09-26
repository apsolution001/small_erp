import { sql } from 'drizzle-orm';
import { type DbExecutor } from './db-executor.js';

/**
 * Serialises writers of one tenant-wide rule that no single constraint can express (a category
 * tree's depth, overlapping numbering series) for the rest of the transaction:
 * `pg_advisory_xact_lock` on a hash of the tenant in context and `scope`. Readers are not
 * blocked, and the lock is released at commit or rollback.
 */
export async function lockTenantScope(db: DbExecutor, scope: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(app_current_tenant()::text || ':' || ${scope}, 0))`,
  );
}
