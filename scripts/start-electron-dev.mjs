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

// 宿主（如 DSH：它自己跑在 Electron 里）可能把 ELECTRON_RUN_AS_NODE=1 传给子进程：
// 留着的话 Electron 退化成纯 Node，启动即 `Cannot read properties of undefined (reading
// 'getVersion')`（app 为 undefined，本机实测）。本脚本的职责就是起应用，必须清掉。
delete env.ELECTRON_RUN_AS_NODE;

// 额外参数原样透传给 Electron，例如 `--remote-debugging-port=9222`：
// 起好之后 Playwright `connectOverCDP('http://127.0.0.1:9222')` 就能接管真实窗口
// （比 `_electron.launch` 稳；用法与另外三条前置见 docs/agents/testing.md）。
const extraArgs = process.argv.slice(2);

const child = spawn(electron, ['.', ...extraArgs], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
