import { spawn } from 'node:child_process';
import electron from 'electron';

// vite-plugin-electron 的 onstart 被置空后（防双实例），`electron .` 拿不到
// VITE_DEV_SERVER_URL，会去加载不存在的 dist/index.html 导致白屏。
// 这里显式注入 dev server 地址再启动 Electron，跨平台（Win/macOS/Linux）。
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173',
  },
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
