import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Local runs read the repo-root .env (git-ignored); variables already set (CI) take precedence.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// SWC is required so Nest decorator metadata is emitted (esbuild does not support it).
const plugins = [swc.vite({ module: { type: 'es6' } })];
// Workspace packages resolve to their TS sources. Tests run in Vite's SSR (node) environment,
// whose conditions are configured separately from the client ones; keep Vite's server defaults.
const conditions = ['@ekaro/source', 'module', 'node', 'development|production'];
const resolve = { conditions };
const ssr = { resolve: { conditions, externalConditions: conditions } };

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        resolve,
        ssr,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        plugins,
        resolve,
        ssr,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          // Migrates the test database (TEST_DB_NAME, default ekaro_test) once per run.
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/setup-file.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
