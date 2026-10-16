#!/usr/bin/env node
/**
 * 用法：node scripts/dev-mobile.mjs（等价：bash scripts/dev-mobile.sh）
 * 说明：1. 主仓库根 node_modules 依赖提升不完整（expo-router 等落在 packages/mobile/node_modules）
 * ，需要 NODE_PATH 指向移动端本地依赖，否则 @expo/cli 解析 expo-router/_ctx-shared 会失败。
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
