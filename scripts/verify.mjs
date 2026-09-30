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
import { existsSync, readdirSync } from 'node:fs';
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

for (const shard of SCOPES[SCOPE]) {
  for (const [label, commandLine, options] of SHARDS[shard]) runStep(label, commandLine, options);
}

console.log(`✓ verify passed (${SCOPE})`);
