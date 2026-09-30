#!/usr/bin/env node
/**
 * verify.mjs — 验证的唯一入口（本地全量与 CI 分片都调这个脚本）。
 *
 * **为什么是 Node 而不是 bash（#500）**：Windows 上 `bash` 常常解析到 WSL 的 Linux bash，
 * 于是 WSL 的 Linux node 去跑 Windows 装的 node_modules → 在 `core:build` 里报
 * `Cannot find module @rollup/rollup-linux-x64-gnu`（长得像 rollup 的问题，其实是平台错配）。
 * Node 是本项目的硬依赖，脚本因此跨 pwsh / cmd / Git Bash / WSL / CI 行为一致。
 * `scripts/verify.sh` 只剩两行 shim（`exec node ...`），CI 与文档里的既有调用串零改动。
 *
 * **验证顺序的唯一出处就是本文件**：CI 每个 job 只写 `verify.mjs <scope>`，不在 workflow 里另拼命令；
 * 文档只引用脚本，不复述步骤序列。边界与理由见 ADR `docs/adr/2026-09-29-ci-verification-boundary.md`。
 *
 * 用法:
 *   npm run verify                     # all：static + renderer + main + core + mobile + expo
 *   npm run verify -- static           # core:build + lint + design-lint + 双端 typecheck + build
 *   npm run verify -- renderer         # 根 vitest（renderer + src/__tests__ 顶层）
 *   npm run verify -- main             # 主进程 vitest（node env，独立 config）
 *   npm run verify -- core             # @mplayer/core vitest
 *   npm run verify -- mobile           # packages/mobile vitest
 *   npm run verify -- expo             # Expo SDK 依赖一致性（expo install --check）
 *   npm run verify -- fast             # = static（兼容旧用法：跳过全部测试）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = process.argv[2] ?? 'all';

/**
 * 跑一步（失败即整体失败，对齐原 bash 的 `set -e`）。
 *
 * 经 shell 起子进程：Windows 上 `npm`/`npx` 是 `.cmd`，POSIX 上是同名可执行，
 * 两端都要能跑。命令串全是本文件里的常量（不含用户输入），没有注入面。
 */
function runStep(label, commandLine, options = {}) {
  console.log(`→ ${label}...`);
  const [file, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', commandLine]]
    : ['sh', ['-c', commandLine]];
  const res = spawnSync(file, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (res.error) {
    console.error(`✗ ${label} 起不来: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    const how = res.status === null ? `signal ${res.signal}` : `exit ${res.status}`;
    console.error(`✗ ${label} 失败（${how}）`);
    process.exit(res.status ?? 1);
  }
}

/**
 * 运行前自检：node_modules 的平台必须与当前 node 一致（#500 的直接教训）。
 * WSL 的 Linux node 用 Windows 装的依赖时，真正炸的地点是 `core:build` 里的 rollup，
 * 报错完全不指向成因。这里提前拦，并给两条可行处置。
 */
function assertNodeModulesMatchPlatform() {
  const rollupDir = path.join(ROOT, 'node_modules', '@rollup');
  if (!existsSync(rollupDir)) return; // 没装依赖是另一回事，让 npm 自己报
  let entries;
  try { entries = readdirSync(rollupDir); } catch { return; }
  const NATIVE = ['rollup-linux-', 'rollup-darwin-', 'rollup-win32-', 'rollup-freebsd-', 'rollup-android-', 'rollup-openbsd-', 'rollup-netbsd-'];
  const native = entries.filter((n) => NATIVE.some((p) => n.startsWith(p)));
  const minePrefix = `rollup-${process.platform}-`;
  const mine = native.filter((n) => n.startsWith(minePrefix));
  const others = native.filter((n) => !n.startsWith(minePrefix));
  if (mine.length > 0 || others.length === 0) return;

  console.error([
    '✗ 依赖与当前 node 不是同一个平台：node_modules 里只有 ' + others.join(' / ') + '，',
    `  而当前 node 是 ${process.platform} ${process.arch}（${process.version}）。`,
    '',
    '  最常见的成因：在 Windows 上用 `bash` 跑验证 —— 那个 bash 是 WSL 的，',
    '  于是 WSL 的 Linux node 去用了 Windows 装的 node_modules。',
    '',
    '  两条处置：',
    '    1) 回到 Windows 侧跑（PowerShell / cmd / Git Bash 都行）：npm run verify -- <scope>',
    '    2) 确实要在 WSL / Linux 里跑：在该环境里重新 `npm ci` 之后再跑',
  ].join('\n'));
  process.exit(1);
}

/** 每个分片的步骤序列：除 core 自己（走源码 alias）外，其余都先 core:build ——
 *  Metro 与测试吃 dist 产物，不重建等于白改。 */
const SHARDS = {
  static: [
    ['core:build', 'npm run core:build'],
    ['lint', 'npm run lint'],
    ['design-lint', 'node scripts/design-lint.mjs'],
    ['root typecheck', 'npm run typecheck'],
    ['mobile typecheck', 'npm run typecheck:mobile'],
    ['build', 'npm run build'],
  ],
  renderer: [
    ['core:build', 'npm run core:build'],
    ['renderer + src/__tests__ 测试', 'npx vitest run'],
  ],
  main: [
    ['core:build', 'npm run core:build'],
    ['main 测试（node env）', 'npm run test:main'],
  ],
  core: [
    ['core 测试', 'npm test -w packages/core'],
  ],
  mobile: [
    ['core:build', 'npm run core:build'],
    ['mobile 测试', 'npx vitest run --config packages/mobile/vitest.config.ts'],
  ],
  expo: [
    ['Expo SDK 依赖一致性（expo install --check）', 'npx expo install --check',
      { cwd: path.join(ROOT, 'packages/mobile'), env: { CI: '1' } }],
  ],
};

/**
 * 运行前自检：**验证实际读到的 core dist，必须存在且不落后于本 checkout 的 core 源码**（#521）。
 *
 * 一条规则同时覆盖两种真实踩过的坑：
 * 1. worktree 用 junction 共享 node_modules 时，`@mplayer/core` 解析到**主 clone** 的 dist ——
 *    你在本树改的 core（含新导出）根本没进验证；症状是移动端报 `TS2305 has no exported member`
 *    或测试找不到新导出，看着像代码错。
 * 2. 改了 core 忘了 `core:build`：dist 是旧的，测试全绿但验的是旧代码（更危险）。
 *
 * `requireDist: false`（启动时）只提示、不拦：`core` 分片走源码 alias，本就不需要 dist。
 * `requireDist: true`（每次 core:build 之后）必须存在且不落后 —— 要证的就是「消费者读到的是刚构建的这份」。
 */
function assertCoreIsFromThisCheckout({ requireDist }) {
  const localCore = path.join(ROOT, 'packages', 'core');
  const localSrc = path.join(localCore, 'src');
  if (!existsSync(localSrc)) return; // 不是本仓结构，交给别的检查
  let coreDir;
  try {
    const require = createRequire(path.join(ROOT, 'package.json'));
    coreDir = path.dirname(require.resolve('@mplayer/core/package.json'));
  } catch {
    return; // 没装依赖是另一回事，让 npm 自己报
  }
  const dist = path.join(coreDir, 'dist', 'index.d.ts');
  const inRepo = coreDir === ROOT || coreDir.startsWith(ROOT + path.sep);
  if (!existsSync(dist)) {
    if (!requireDist) {
      console.log(`✓ core 来源：${coreDir}（尚无 dist，core 分片走源码 alias）`);
      return;
    }
    console.error([
      `✗ core:build 之后仍读不到 dist：${dist}`,
      `  本 checkout 的 core：${localCore}`,
      '',
      '  处置：让 \`@mplayer/core\`（根与 packages/mobile 的 node_modules）指向本 checkout 的 packages/core，',
      '  再 npm run core:build —— worktree 用 junction 共享 node_modules 时最容易踩。',
    ].join('\n'));
    process.exit(1);
  }
  // 新鲜度只在 core:build 之后判：启动时 dist 可能是上一轮的产物，那一刻判会误伤（分片自己会先重建）
  if (requireDist && newestMtime(localSrc) > statSync(dist).mtimeMs) {
    console.error([
      '✗ 验证实际读到的 core dist 落后于本 checkout 的 core 源码。',
      `   本 checkout 源码：${localSrc}`,
      `   实际读到的 dist：${dist}${inRepo ? '' : '  ← 不在本 checkout 内（worktree 的 core 链接指向别处）'}`,
      '',
      '  先 npm run core:build；若 dist 仍不在本 checkout 内，则把 \`@mplayer/core\` 的链接',
      '  （根与 packages/mobile 的 node_modules）改指向本 checkout 的 packages/core ——',
      '  否则你在本树构建的 core 没有任何消费者会读到。',
    ].join('\n'));
    process.exit(1);
  }
  console.log(`✓ core 自检：读到的 dist 不落后于本 checkout 源码（${coreDir}）`);
}

/** 目录下所有文件的最新 mtime（只用于构建产物新鲜度判断） */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

const SCOPES = {
  all: ['static', 'renderer', 'main', 'core', 'mobile', 'expo'],
  static: ['static'],
  fast: ['static'],
  renderer: ['renderer'],
  main: ['main'],
  core: ['core'],
  mobile: ['mobile'],
  expo: ['expo'],
};

if (!Object.hasOwn(SCOPES, SCOPE)) {
  console.error(`未知 scope: ${SCOPE}`);
  console.error(`可用: ${Object.keys(SCOPES).join(' / ')}`);
  process.exit(2);
}

assertNodeModulesMatchPlatform();
assertCoreIsFromThisCheckout({ requireDist: false });

for (const shard of SCOPES[SCOPE]) {
  for (const [label, commandLine, options] of SHARDS[shard]) {
    runStep(label, commandLine, options);
    // 构建后立刻自证：消费者解析到的那份 dist 就是刚构建的这份（#521 的 junction 陷阱）
    if (label === 'core:build') assertCoreIsFromThisCheckout({ requireDist: true });
  }
}

console.log(`✓ verify passed (${SCOPE})`);
