import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so Nest decorator metadata is emitted (esbuild does not support it).
const plugins = [swc.vite({ module: { type: 'es6' } })];
const resolve = { conditions: ['@ekaro/source'] };

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        resolve,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        plugins,
        resolve,
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
