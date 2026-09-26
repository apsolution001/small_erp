/**
 * TS properties are camelCase and DB columns snake_case (docs/standards/backend.md).
 * Shared by the runtime clients and drizzle.config.ts so generated SQL and queries agree.
 */
export const DB_CASING = 'snake_case' as const;
