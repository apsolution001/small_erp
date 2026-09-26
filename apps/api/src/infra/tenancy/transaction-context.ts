import { sql } from 'drizzle-orm';
import { type DbExecutor } from '../db/db-executor.js';

export interface TransactionContextValues {
  readonly tenantId: string | undefined;
  readonly userId: string | undefined;
  readonly requestId: string | undefined;
}

/**
 * Sets `app.tenant_id`, `app.user_id` and `app.request_id` for the current transaction only
 * (`set_config(..., true)`, ADR 0003): what RLS policies, column defaults and the audit trigger
 * read. Missing values are set empty, which reads as NULL (fail closed). Must run inside a
 * transaction, or the settings would last for one statement only.
 */
export async function applyTransactionContext(
  db: DbExecutor,
  values: TransactionContextValues,
): Promise<void> {
  await db.execute(sql`select
    set_config('app.tenant_id', ${values.tenantId ?? ''}, true),
    set_config('app.user_id', ${values.userId ?? ''}, true),
    set_config('app.request_id', ${values.requestId ?? ''}, true)`);
}
