import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/main/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/main/setup.ts'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'lcov', 'text-summary'],
      include: ['src/main/**'],
      exclude: ['src/__tests__/**', '**/*.test.*', '**/node_modules/**'],
    },
  },
});
