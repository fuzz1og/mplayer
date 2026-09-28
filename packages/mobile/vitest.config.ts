import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // #425：区段级 UI 测试在 jsdom 下渲染——RN 原语映射到 react-native-web
      // （Metro 打包仍走真正的 react-native，只在 vitest 里替换）。
      'react-native': 'react-native-web',
    },
  },
  test: {
    root: __dirname,
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['__tests__/setup.ts'],
  },
});
