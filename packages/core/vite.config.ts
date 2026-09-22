import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts(),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs',
    },
    resolve: {
      alias: {
        // iconv-lite→safer-buffer 的 require('buffer') 会被 Vite 6 lib 构建
        // (consumer:"client") 替换成 __vite-browser-external 空桩，导致 CJS 产物
        // Buffer.prototype 为 undefined 崩溃；而 external 只对桌面 Node 生效，
        // 移动端 RN 运行时没有 buffer 模块。alias 到 feross/buffer 内联 polyfill，
        // 桌面与 Metro 两端都能拿到真实 Buffer 实现。
        buffer: 'buffer/',
      },
    },
    rollupOptions: {
      // music-metadata：护栏 L2 时长取证用的只读解析器（懒加载 import）。
      // 与桌面主进程构建（根 vite.config.ts）一致地 external，避免把解析器
      // 打进 core 产物；宿主/移动端从 node_modules 解析，缺失时护栏自动降级。
      external: ['axios', 'music-metadata'],
    },
    // 产物被桌面/移动端打包器内联，sourcemap 只会白白增大 dist 体积
    sourcemap: false,
  },
});
