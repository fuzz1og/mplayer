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
      },
      // Preload 脚本（审查修复：contextIsolation 启用，渲染层经 window.electronAPI 通信）
      {
        entry: 'src/main/preload.ts',
        onstart() {},
        vite: {
          build: {
            target: 'esnext',
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
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
    port: 5174,
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
        // 只钉真正全局共享的运行时；**不钉 antd**（#412）。
        // 此前 `antd: ['antd']` 把整个组件库塞进一个 chunk：入口只要用到任何一个
        // antd 组件，这个 chunk 就整体进首屏，路由级（懒加载页面）的按需拆分被抹平。
        // 去掉后交给 Rollup 按实际 import 图切分——每个路由只带自己用到的部分。
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
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
    // 只收渲染层与 src/__tests__ 顶层的用例；主进程测试（src/__tests__/main/**）
    // 归 vitest.main.config.ts（node env）+ npm run test:main —— 否则同一批用例会在
    // jsdom 与 node 两种环境下各跑一遍（见 ADR 2026-09-29-ci-verification-boundary）
    include: ['src/renderer/__tests__/**/*.test.{ts,tsx}', 'src/__tests__/*.test.{ts,tsx}'],
    setupFiles: ['src/renderer/__tests__/setup.ts']
  }
});