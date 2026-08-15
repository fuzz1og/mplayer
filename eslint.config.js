const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  // Global ignores
  {
    ignores: ['dist/', 'dist-electron/', 'coverage/', 'node_modules/', 'packages/core/dist/', 'packages/core/coverage/', '.expo/', 'packages/mobile/.expo/', 'src/main/storage/fileStorage.ts', '.dsh-worktrees/', '.claude/worktrees/'],
  },
  // Base recommended rules
  ...tseslint.configs.recommended,
  // Project configuration
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-case-declarations': 'off',
    },
  },
);
