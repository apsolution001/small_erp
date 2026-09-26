import { runMigrations } from '../../src/infra/db/migrator.js';
import { loadTestEnv, testDatabaseName } from './test-env.js';

/** Vitest global setup (e2e project): bring the test database to the latest migration. */
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  try {
    await runMigrations(env.DATABASE_URL_OWNER);
  } catch (error) {
    throw new Error(
      `Could not migrate test database "${testDatabaseName()}". Is Postgres up, and did you run ` +
        `\`bash apps/api/scripts/setup-local-db.sh ${testDatabaseName()}\`?`,
      { cause: error },
    );
  }
}
