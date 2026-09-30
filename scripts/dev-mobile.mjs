#!/usr/bin/env node
/**
 * dev-mobile.mjs — 移动端 Expo dev server（Windows / macOS / Linux）
 * 移植自 scripts/dev-mobile.sh（#502）：行为一致，只是不再需要 bash。
 * 用法：node scripts/dev-mobile.mjs（等价：bash scripts/dev-mobile.sh）
 *
 * 说明：
 * 1. 主仓库根 node_modules 依赖提升不完整（expo-router 等落在
 *    packages/mobile/node_modules），需要 NODE_PATH 指向移动端本地依赖，
 *    否则 @expo/cli 解析 expo-router/_ctx-shared 会失败。
 * 2. Metro 的 watcher 已通过 packages/mobile/metro.config.js 的 blockList
 *    排除易消失的构建产物目录（vitest 临时目录、android/build 等），
 *    避免 Windows 上「外部进程删除目录导致 watcher 崩溃」。
 * 3. 非 CI 模式启动：保留热重载（Fast Refresh）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'packages', 'mobile');

// 前台长驻进程：stdio 直通，Ctrl-C 原样交给 expo。Windows 上 npx 是 .cmd，需要经 cmd.exe。
const [file, args] = process.platform === 'win32'
  ? ['cmd.exe', ['/d', '/s', '/c', 'npx expo start --port 8091']]
  : ['npx', ['expo', 'start', '--port', '8091']];

const child = spawn(file, args, {
  cwd: MOBILE,
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: path.join(MOBILE, 'node_modules') },
});

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
