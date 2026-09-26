import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
