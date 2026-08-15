import { spawn } from 'node:child_process';
import fs from 'node:fs';
import electron from 'electron';

// vite-plugin-electron 的 onstart 被置空后（防双实例），`electron .` 拿不到
// VITE_DEV_SERVER_URL，会去加载不存在的 dist/index.html 导致白屏。
// 这里显式注入 dev server 地址再启动 Electron，跨平台（Win/macOS/Linux）。
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5174',
};

// WSLg 自动补环境：WSL 里常缺 DISPLAY/PULSE_SERVER/XDG_RUNTIME_DIR，
// 不补的话 Electron 窗口不弹到 Windows、也没有声音。
const wslgX11 = '/mnt/wslg/.X11-unix/X0';
const wslgPulse = '/mnt/wslg/PulseServer';
const wslgRuntime = '/mnt/wslg/runtime-dir';
if (!env.DISPLAY && fs.existsSync(wslgX11)) env.DISPLAY = ':0';
if (!env.PULSE_SERVER && fs.existsSync(wslgPulse)) env.PULSE_SERVER = 'unix:/mnt/wslg/PulseServer';
if (!env.XDG_RUNTIME_DIR && fs.existsSync(wslgRuntime)) env.XDG_RUNTIME_DIR = wslgRuntime;

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
