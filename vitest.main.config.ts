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
    // 默认 5s 对「真 fs I/O」的集成用例（localMusicStore 扫目录、diskBackend 写索引）在忙机器上不够：
    // #510 实测同一台机器上「加一个目录只写它的分片…」与「单次变更的写盘量与曲库总规模无关」
    // 分别跑到 8785ms / 6207ms 后报 `Test timed out in 5000ms`（不是断言失败，是预算被负载吃掉）。
    // 与 renderer 同口径——vite.config.ts 早在 #521 就设了 20s；CI 的分片是独立 runner，放宽不会掩盖真失败。
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text', 'lcov', 'text-summary'],
      include: ['src/main/**'],
      exclude: ['src/__tests__/**', '**/*.test.*', '**/node_modules/**'],
    },
  },
});
