#!/usr/bin/env node
/**
 * zod-drift-guard.mjs — zod 越界 override 的漂移守卫（#676）：钉版落没落 lock、
 * 是不是死配置、被越界的 @expo/cli 运行产物有没有漂进 zod 4 已移除的符号。
 * 完整 parity 复验义务见 ADR「override 的越界维护义务」（CODING_STANDARDS.md:11 的守卫范式）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const semver = require('semver');

/** GHSA-mrhx-c7xc-m3w5（OSV，复核时刻 2026-10-27）：introduced 0 → fixed 4.6.6 */
const ADVISORY_FIXED = '4.6.6';
/** 当前唯一「声明区间挡住修复线」的包：zod 只在它的运行产物里被 require */
const DECLARER = '@expo/cli';
// lock 里 @expo/cli 嵌在 node_modules/expo 下；跨 npm 版本若 hoist 到根，两个位置都认
const CLI_BUILD = [
  path.join(ROOT, 'node_modules', 'expo', 'node_modules', DECLARER, 'build'),
  path.join(ROOT, 'node_modules', DECLARER, 'build'),
].find((p) => existsSync(p));
/** zod 4 已移除符号 / v3-only issue code：越界钉在 4.x 时出现即运行时炸 */
const V3_ONLY_TOKENS = ['ZodTypeAny', 'invalid_enum_value', 'invalid_string'];

const fails = [];
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pinned = (pkg.overrides || {}).zod;
let lock;
try { lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')); }
catch { lock = null; }
if (!lock) {
  console.log('✓ zod 漂移守卫：lock 不可读，跳过（安装期问题由 npm 自己报）');
  process.exit(0);
}

// lock 口径 = CI 口径（ADR 复核时刻原则：比对口径以 lock 为准）
const declarers = [];
for (const [key, val] of Object.entries(lock.packages || {})) {
  const spec = (val.dependencies || {}).zod || (val.peerDependencies || {}).zod;
  if (spec) declarers.push({ pkg: key.replace(/^node_modules\//, ''), spec });
}
const lockZod = (lock.packages || {})['node_modules/zod']?.version;
const sat = (ver, spec) => { try { return semver.satisfies(ver, spec); } catch { return true; } };

if (pinned) {
  // 失效三成因第 1 类：非根 override 静默不生效 → lock 没吃到钉版
  if (!lockZod || !sat(lockZod, pinned)) {
    fails.push(['钉版未落 lock', '根 overrides.zod = ' + pinned + '，lock 解析为 ' + (lockZod ?? '无')]);
  }
  const blocked = declarers.filter(({ spec }) => lockZod && !sat(lockZod, spec));
  // ADR「override 生命周期」：所有声明者都接受钉上了 = 死配置，按 uuid 判据删
  if (lockZod && declarers.length > 0 && blocked.length === 0) {
    fails.push(['死配置', '所有 zod 声明者区间都已接受 ' + lockZod + '，overrides.zod 应删（删后 npm install --package-lock-only 须零变化）']);
  }
  // 越界中：被挡声明者（现即 @expo/cli）的运行产物漂进 v3-only 符号
  if (lockZod && blocked.length > 0) {
    if (!CLI_BUILD) {
      console.log('⚠ zod 漂移守卫：' + DECLARER + ' 运行产物未安装，符号检查跳过（安装期状态，不判红）');
    } else {
      const hits = [];
      const stack = [CLI_BUILD];
      while (stack.length) {
        const dir = stack.pop();
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) stack.push(p);
          else if (e.name.endsWith('.js')) {
            const text = readFileSync(p, 'utf8');
            for (const tok of V3_ONLY_TOKENS) if (text.includes(tok)) hits.push(path.relative(ROOT, p) + ' → ' + tok);
          }
        }
      }
      if (hits.length) fails.push(['越界面漂移', DECLARER + ' 运行产物出现 zod 4 已移除符号（钉 ' + lockZod + ' 会运行时炸）：\n    ' + hits.join('\n    ')]);
    }
  }
} else if (lockZod && semver.lt(lockZod, ADVISORY_FIXED) && declarers.length > 0 && declarers.every(({ spec }) => sat(ADVISORY_FIXED, spec))) {
  // 声明区间已全解禁而 lock 仍低于修复线：干净升级路径开了
  fails.push(['可干净解除', '声明者区间已全接受 ≥' + ADVISORY_FIXED + '，lock 仍为 ' + lockZod + '——按原声明升级即可，不需要 override']);
}

if (fails.length) {
  console.error('✗ zod 漂移守卫（#676）：');
  for (const [rule, msg] of fails) console.error('  [' + rule + '] ' + msg);
  console.error('');
  console.error('  处置：ADR docs/adr/2026-09-29-dependency-update-governance.md「override 的越界维护义务」');
  console.error('  复验配方：#668 验收评论（消费点 grep → v3/v4 parity → 三条 Expo 链路 + lint）');
  process.exit(1);
}
console.log('✓ zod 漂移守卫：' + (pinned ? '越界钉版中（钉 ' + pinned + '）' : '无钉版（lock ' + lockZod + '）') + '，声明者 ' + declarers.length + ' 个，无漂移信号');
