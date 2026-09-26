import 'reflect-metadata';
import { afterAll } from 'vitest';
import { closeTestPools } from './db.js';

// Runs in every e2e test file: release the raw test connections when the file is done.
afterAll(async () => {
  await closeTestPools();
});
