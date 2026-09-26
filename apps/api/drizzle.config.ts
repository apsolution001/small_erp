import { defineConfig } from 'drizzle-kit';
import { DB_CASING } from './src/infra/db/casing.js';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from './src/infra/db/migrator.js';

// `pnpm --filter @ekaro/api db:generate` diffs the Drizzle schema into SQL.
// Hand-written SQL (functions, RLS, grants, triggers): `db:generate --custom --name=<slug>`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/db/schema.ts',
  out: './db/migrations',
  casing: DB_CASING,
  migrations: { table: MIGRATIONS_TABLE, schema: MIGRATIONS_SCHEMA },
  strict: true,
  verbose: true,
});
