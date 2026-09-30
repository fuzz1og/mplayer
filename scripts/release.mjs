#!/usr/bin/env node
/**
 * release.mjs — 一键发布新版（对齐当前工作流：version-bump.js 同步 5 文件 + CI 构建发布）
 * 移植自 scripts/release.sh（#502）：步骤、输出与退出码一致，只是不再需要 bash。
 *
 * 用法: node scripts/release.mjs 1.7.2        # 指定完整版本号
 *       node scripts/release.mjs patch        # 递增 patch（1.7.1 → 1.7.2）
 *       node scripts/release.mjs minor        # 递增 minor（1.7.1 → 1.8.0）
 *       node scripts/release.mjs 1.7.2 --skip-verify   # 跳过本地验证（CI 也会验证）
 *
 * 流程: 验证 → version-bump → commit → push master → tag → push tag（触发 GitHub Actions 发布）
 *
 * 跨平台要点：全程用**数组参数**起子进程（不拼命令行），用户给的目标版本因此没有注入面；
 * node 一律用 process.execPath（不依赖 PATH 里的 node），git 用 git。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(ROOT, 'scripts', 'verify.mjs');

/** inherit stdio 地跑一条命令，返回退出码（起不来按 1 计） */
function run(file, args) {
  const res = spawnSync(file, args, { stdio: 'inherit', cwd: ROOT });
  if (res.error) { console.error(res.error.message); return 1; }
  return res.status ?? 1;
}

/** 捕获输出地跑一条命令（只用于 git 查询，不回显） */
function capture(file, args) {
  const res = spawnSync(file, args, { encoding: 'utf8', cwd: ROOT });
  return { status: res.status ?? 1, stdout: (res.stdout ?? '').trim() };
}

const [, , target, flag] = process.argv;

if (!target) {
  console.error('用法: node scripts/release.mjs <version|patch|minor|major> [--skip-verify]');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const cur = pkg.version;
const [major, minor, patch] = cur.split('.').map(Number);
const next = target === 'patch' ? major + '.' + minor + '.' + (patch + 1)
  : target === 'minor' ? major + '.' + (minor + 1) + '.0'
  : target === 'major' ? (major + 1) + '.0.0'
  : target;

console.log('当前版本: ' + cur + ' → 新版本: ' + next);

// 1. 分支检查：只在 master 发版
const branch = capture('git', ['branch', '--show-current']).stdout;
if (branch !== 'master') {
  console.error('错误: 发布必须在 master 分支（当前 ' + branch + '）');
  process.exit(1);
}

// 2. 验证（唯一入口见 docs/adr/2026-09-29-ci-verification-boundary.md）
if (flag !== '--skip-verify') {
  if (run(process.execPath, [VERIFY]) !== 0) {
    console.error('验证失败，发布中止');
    process.exit(1);
  }
}

// 3. bump 版本（同步 package.json / package-lock.json / app.json / mobile/core package.json）
const bump = path.join(ROOT, 'scripts', 'version-bump.js');
if (run(process.execPath, [bump, next]) !== 0) process.exit(1);
if (run(process.execPath, [bump, '--check']) !== 0) process.exit(1);

// 4. 提交 + 推送（无改动时 commit 会失败，这是正常的——对齐原脚本的 `|| true`）
run('git', ['add', 'package.json', 'package-lock.json', 'packages/mobile/app.json', 'packages/mobile/package.json', 'packages/core/package.json']);
run('git', ['commit', '-m', 'chore: bump version to ' + next]);
if (run('git', ['push', 'origin', 'master']) !== 0) process.exit(1);

// 5. tag + 推送（触发 release.yml 构建发布）
if (run('git', ['tag', '-a', 'v' + next, '-m', 'v' + next]) !== 0) process.exit(1);
if (run('git', ['push', 'origin', 'v' + next]) !== 0) process.exit(1);

console.log('✓ 已推送 v' + next + '，GitHub Actions 构建发布中。监控: gh run watch');
