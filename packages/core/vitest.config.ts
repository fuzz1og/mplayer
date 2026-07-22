import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    root: __dirname,
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'lcov', 'text-summary'],
      include: ['src/**'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**', '**/dist/**'],
    },
  },
  resolve: {
    alias: {
      '@mplayer/core': resolve(__dirname, './src'),
    },
  },
});
