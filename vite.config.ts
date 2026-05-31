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
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
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
    port: 5173
  },
  build: {
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
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