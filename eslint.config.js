// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Only @ekaro/core configures decimal.js (ADR 0005); everything else uses its clone. */
const decimalJsImport = {
  name: 'decimal.js',
  message:
    'Import Decimal / toDecimal / parseQty / parseRate from @ekaro/core: a bare decimal.js has the wrong precision and rounding (ADR 0005).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'apps/api/db/migrations/**',
      'apps/web/src/routeTree.gen.ts',
      'apps/web/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Money safety: parseFloat/Number on money strings is forbidden; use @ekaro/core.
    files: ['apps/**/*.{ts,tsx}', 'packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use Decimal / Money from @ekaro/core.' },
      ],
    },
  },
  {
    // Precision safety: decimal.js is configured once, in packages/core.
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ignores: ['packages/core/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [decimalJsImport] }] },
  },
  {
    // Module boundaries (ADR 0001, 0003): only platform/auth may use the platform DB connection.
    // Repeats the decimal.js restriction because a later rule entry replaces an earlier one.
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['apps/api/src/modules/platform/**', 'apps/api/src/modules/auth/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [decimalJsImport],
          patterns: [
            {
              group: ['**/infra/db/platform-db*'],
              message:
                'Platform DB connection is restricted to modules/platform and modules/auth (ADR 0003).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{test,spec,e2e-spec}.{ts,tsx}', '**/test/**/*.ts', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
