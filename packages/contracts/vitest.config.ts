import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@ekaro/source'] },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/testing/**'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
  },
});
