// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import root from '../../eslint.config.js';

export default tseslint.config(
  ...root,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    // Route modules export `Route`; the router plugin code-splits their components (autoCodeSplitting).
    files: ['src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
