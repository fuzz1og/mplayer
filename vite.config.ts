/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.ts',
        // 空 onstart 阻止插件自动拉起 electron（无 onstart 时插件默认也会 startup）——
        // 否则会和 `npm run electron:dev` 脚本里的 `electron .` 形成双实例
        //（共享同一份 userData/storage，双倍请求 + 刷新流程互相干扰）
        onstart() {},
        vite: {
          build: {
            target: 'esnext',
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'music-metadata', 'mp3tag.js']
            }
          },
          define: {
            'process.env.MUSIC_API_URL': JSON.stringify(process.env.MUSIC_API_URL || '')
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    // 忽略测试产物目录，避免 vitest 写入 coverage 触发页面 reload/重建风暴
    watch: {
      ignored: ['**/coverage/**', '**/test-results/**', '**/dist-electron/**'],
    },
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    minify: 'esbuild',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
          antd: ['antd'],
          howler: ['howler'],
          icons: ['lucide-react'],
          axios: ['axios']
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/renderer/__tests__/**/*.test.{ts,tsx}', 'src/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['src/renderer/__tests__/setup.ts']
  }
});