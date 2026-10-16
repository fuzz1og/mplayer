#!/usr/bin/env node
/**
 * lint-staged.mjs — 对暂存的 .ts/.tsx 分批跑 eslint（#654）。
 * 不经 shell 直接 spawn node，且每批文件数/字符数受限，绕开 Windows 命令行长度上限。
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 单批上限。Windows CreateProcess 的命令行上限是 32767 字符、cmd.exe 约 8191：
 * 长 worktree 路径下按 40 文件 / 6000 字符双闸门分批，两条上限都碰不到。
 */
export const MAX_FILES = 40;
export const MAX_CHARS = 6000;

/** 按「文件数」与「字符数」双闸门把清单切批；空清单返回空数组（不 spawn 空调用）。 */
export function planInvocations(files, maxFiles = MAX_FILES, maxChars = MAX_CHARS) {
  const batches = [];
  let cur = [];
  let len = 0;
  for (const file of files) {
    const cost = file.length + 1;
    if (cur.length > 0 && (cur.length >= maxFiles || len + cost > maxChars)) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(file);
    len += cost;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** 暂存的 .ts/.tsx。`--diff-filter=d` 排除删除项 —— 删掉的文件没有内容可 lint。 */
export function stagedLintTargets(runGit = gitStaged) {
  return runGit().filter((file) => /\.(ts|tsx)$/.test(file));
}

function gitStaged() {
  const res = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=d', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) return [];
  return res.stdout.split('\0').filter(Boolean);
}

/** 从本仓的 eslint 包解析 CLI 入口，避免依赖 .bin shim 或 PATH。 */
function eslintBin() {
  const require = createRequire(path.join(ROOT, 'package.json'));
  return path.join(path.dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');
}

function main() {
  const files = stagedLintTargets();
  if (files.length === 0) {
    console.log('（无暂存的 .ts/.tsx，跳过 lint）');
    return;
  }
  const bin = eslintBin();
  const batches = planInvocations(files);
  console.log(`→ eslint：${files.length} 个暂存文件，分 ${batches.length} 批`);
  for (const batch of batches) {
    const res = spawnSync(process.execPath, [bin, '--no-warn-ignored', '--max-warnings', '0', ...batch], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (res.error) {
      console.error('✗ eslint 起不来：' + res.error.message);
      process.exit(1);
    }
    if (res.status !== 0) process.exit(res.status ?? 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
