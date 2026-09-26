import { and, eq, inArray } from 'drizzle-orm';
import { type DbExecutor } from '../../../infra/db/db-executor.js';
import { branches } from './branches.schema.js';

/**
 * Which of `ids` are active branches of the tenant in context (RLS scopes the read), for callers
 * that grant a branch scope: user management (app connection) and invitation acceptance
 * (platform connection with the invitation's tenant in context).
 */
export async function findActiveBranchIds(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(inArray(branches.id, [...ids]), eq(branches.isActive, true)));
  return new Set(rows.map((r) => r.id));
}
