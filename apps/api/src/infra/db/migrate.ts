import { EnvValidationError, loadMigrationEnv } from '../../config/env.js';
import { runMigrations } from './migrator.js';

/** CLI: `pnpm --filter @ekaro/api db:migrate` (or `node dist/infra/db/migrate.js`). */
async function main(): Promise<void> {
  const env = loadMigrationEnv();
  await runMigrations(env.DATABASE_URL_OWNER);
  process.stdout.write('migrations applied\n');
}

main().catch((error: unknown) => {
  const message =
    error instanceof EnvValidationError
      ? error.message
      : error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
  process.stderr.write(`migration failed\n${message}\n`);
  process.exitCode = 1;
});
