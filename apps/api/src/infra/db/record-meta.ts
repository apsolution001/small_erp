/**
 * The columns an update writes: a subset of an insert's business columns. A parsed PATCH body
 * types its absent fields as `?: T | undefined`, and Drizzle skips `undefined` in `set()`.
 */
export type RowChanges<TInsert, K extends keyof TInsert> = {
  [P in K]?: TInsert[P] | undefined;
};

/** The standard columns a tenant row returns (`recordMetaShape` in contracts). */
export interface RecordMeta {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * `id`, `version` and the timestamps of a row, as the contracts carry them (ISO strings). The
 * internal columns (`tenant_id`, `created_by`, `updated_by`) are never part of a response.
 */
export function recordMetaOf(row: {
  readonly id: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): RecordMeta {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
