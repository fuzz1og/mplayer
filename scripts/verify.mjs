#!/usr/bin/env node
/**
 * verify.mjs — 验证的唯一入口（本地全量与 CI 分片都调这个脚本）。
 * **验证顺序的唯一出处就是本文件**：CI 每个 job 只写 `verify.mjs <scope>`，不在 workflow 里另拼命令；文档只引用脚本、不复述步骤。用 Node 而非 bash（#500）——
 * Windows 的 `bash` 常解析到 WSL Linux bash，会拿 WSL 的 node 跑 Windows 装的依赖、报 rollup 平台错配。用法：`npm run verify [-- <scope>]`。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
  const fail = (message) => {
    console.error(message);
    if (options.exitOnFail === false) return false; // 交给调用方分类（expo 上游漂移，见 classifyExpoFailure）
    process.exit(1);
  };
  const [file, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', commandLine]]
    : ['sh', ['-c', commandLine]];
  const res = spawnSync(file, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (res.error) return fail(`✗ ${label} 起不来: ${res.error.message}`);
  if (res.status !== 0) {
    const how = res.status === null ? `signal ${res.signal}` : `exit ${res.status}`;
    return fail(`✗ ${label} 失败（${how}）`);
  }
  return true;
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
    ['docs 门禁', 'node scripts/docs-gate.mjs'],
    // #654：comment-gate 随 #653 合入却从未接进这里 —— 脚本在仓库里、CI 与 verify 都不跑它（假门禁）。
    ['注释门禁', 'node scripts/comment-gate.mjs'],
    // #676：zod 越界 override（#673）的漂移守卫——CODING_STANDARDS.md:11 范式，复验义务句在 ADR，机械子集在这。
    ['zod 漂移守卫', 'node scripts/zod-drift-guard.mjs'],
    ['core:build', 'npm run core:build'],
    // #557：core 自己的 typecheck 此前谁都不跑——core 是双端共享的核心，
    // 它的类型错误当时只有人肉跑 npm run typecheck -w packages/core 才能发现。
    ['core typecheck', 'npm run typecheck -w packages/core'],
    ['lint', 'npm run lint'],
    // 桌面端严格模式与移动端同级（1.9.0 #689）：内联样式 / 色值字面量 / antd 引入 /
    // 字号字重圆角字面量四条硬规则，无存量白名单——清到 0 之后才接线，防止回潮。
    ['design-lint', 'node scripts/design-lint.mjs --desktop-strict'],
    ['claim-lint', 'node scripts/claim-lint.mjs'],
    // #717：门禁登记——门禁脚本 / npm 门禁命令必须被某个入口调用，防「脚本在仓库里但没人跑」的假门禁（#654）
    ['门禁登记', 'node scripts/gate-registry.mjs'],
    ['版本一致性', 'npm run version:check'],
    // #717：页面测试覆盖——路由新增的懒加载页面必须带测试
    ['页面测试覆盖', 'node scripts/page-coverage.mjs'],
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
      { cwd: path.join(ROOT, 'packages/mobile'), env: { CI: '1' }, upstreamDrift: true }],
  ],
};

/**
 * 运行前自检：**验证实际读到的 core dist，必须存在且不落后于本 checkout 的 core 源码**（#521）。
 * `requireDist: true`（每次 core:build 之后）必须存在且不落后 —— 要证的就是「消费者读到的是刚构建
 * 的这份」。
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

/**
 * 运行前自检：node_modules 的版本必须与 package-lock.json 一致（#523）。
 * 依赖 PR 合并后本机 node_modules 必然落后，症状却落在别处：lint 报 Cannot find module 
 * 'eslint-plugin-react-hooks'、core:build 报 pako 的 TS7016 ——两条都不指向「该 npm ci 了」。
 */
function assertNodeModulesMatchLockfile() {
  const readJson = (p) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  };
  const want = readJson(path.join(ROOT, 'package-lock.json'));
  const have = readJson(path.join(ROOT, 'node_modules', '.package-lock.json'));
  if (!want || !have) return; // 没装依赖是另一回事，让 npm 自己报
  const wantPkgs = want.packages ?? {};
  const havePkgs = have.packages ?? {};
  const drift = [];
  for (const [key, entry] of Object.entries(wantPkgs)) {
    if (!key || entry.link || entry.optional) continue;
    if (!entry.resolved && !entry.integrity) continue; // workspace 清单条目（见上）
    const installed = havePkgs[key];
    if (!installed) drift.push(key + '（未安装）');
    else if (installed.version !== entry.version) drift.push(key + '（lock ' + entry.version + ' ≠ 装的 ' + installed.version + '）');
  }
  if (drift.length === 0) {
    console.log('✓ 依赖自检：node_modules 与 package-lock.json 一致');
    return;
  }
  console.error([
    '✗ node_modules 与 package-lock.json 不一致（' + drift.length + ' 处，前 5 条）：',
    ...drift.slice(0, 5).map((d) => '    ' + d),
    '',
    '  最常见的成因：依赖相关的提交合并进来之后没重装。',
    '',
    '  处置：npm ci --ignore-scripts（与 CI 同款）；若要跑 electron:dev / electron:build，',
    '  再补 npx install-electron 下载 Electron 二进制（Electron 42 起已移除 postinstall，',
    '  npm rebuild electron 会空转，见 docs/agents/testing.md）。',
  ].join('\n'));
  process.exit(1);
}

/**
 * 本仓允许「base 写 master、分支堆叠在别的分支上」（`ci.yml` 只对 base=master 跑 CI），但合入前**必
 * 须确认基座已合**——否则本分支会把基座那份**旧拷贝**一起带进 master（#520 实测：栈底带着 #516 的
 * 旧版 core/desktop 改动；先合 #520 就会把旧版桌面改动写回 master）。
 */
function reportBranchBase() {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const hasRef = (ref) => git(['rev-parse', '--verify', '--quiet', ref]).status === 0;
  if (!hasRef('HEAD')) return;
  if (!hasRef('origin/master')) {
    console.log('• 堆叠自检：本地无 origin/master，跳过（先 `git fetch origin`）');
    return;
  }
  const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', a, b]).status === 0;
  if (isAncestor('origin/master', 'HEAD')) {
    console.log('✓ 分支已基于 origin/master');
    return;
  }
  // 三态判定的第二态：HEAD 是 master 的祖先 = 分支**已合入**（或本地落后）——这**不是**堆叠。
  // 实测（#520 合入后）：漏了这一态就会打印「未基于 master + 0 个文件」，比不检查还误导。
  if (isAncestor('HEAD', 'origin/master')) {
    console.log('• 本分支已在 origin/master 的历史里（多半已合入、或本地落后）：切新分支或 pull --rebase 即可，不涉及堆叠处置');
    return;
  }
  const files = (git(['diff', '--name-only', 'origin/master...HEAD']).stdout ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log([
    '⚠ 本分支未基于 origin/master（= 堆叠 PR；合法，但**合入前必须确认基座已合**）。',
    `  相对 master 的文件集合（${files.length} 个）——逐项确认是否都属于本票：`,
    ...files.map((f) => `    ${f}`),
    '  基座已合 → `git fetch origin master && git rebase origin/master` 收敛；未合 → 等它合入。',
  ].join('\n'));
}

/**
 * expo 分片失败时的自分类（#717）：上游发新期望补丁会让它独立变红（ADR 2026-09-29-dependency-update-governance）。
 * 只看「本改动有没有碰依赖文件」：没碰 = 上游漂移，出 warning 不拦；碰了、取不到 diff、或 master 自身运行，照旧拦。
 */
const DEPENDENCY_FILES = /(^|\/)(package\.json|package-lock\.json|app\.json)$/;

function classifyExpoFailure() {
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const committed = git(['diff', '--name-only', 'origin/master...HEAD']);
  if (committed.status !== 0) {
    const why = (committed.stderr ?? '').trim().split('\n')[0] || 'git diff 失败';
    return { drift: false, why: '取不到 origin/master...HEAD 的 diff：' + why + '（先 git fetch origin master）' };
  }
  // 未提交的改动（含暂存）也算：本地还没 commit 时只看已提交的一半，会误判成「master 自身运行」
  const pending = git(['diff', '--name-only', 'HEAD']);
  const files = [...new Set([
    ...(committed.stdout ?? '').split('\n'),
    ...(pending.stdout ?? '').split('\n'),
  ].map((s) => s.trim()).filter(Boolean))];
  if (files.length === 0) return { drift: false, why: 'HEAD 与 origin/master 无差异且工作树干净（master 自身运行），保留红灯' };
  const deps = files.filter((file) => DEPENDENCY_FILES.test(file));
  if (deps.length > 0) return { drift: false, why: '本改动触及依赖文件：' + deps.slice(0, 5).join(', ') };
  return { drift: true, why: '本改动未触及任何依赖文件（改动 ' + files.length + ' 个文件），判定为上游漂移' };
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
  stack: [], // 无步骤：只跑上面的 pre-check（reportBranchBase），合入前手工跑
};

if (!Object.hasOwn(SCOPES, SCOPE)) {
  console.error(`未知 scope: ${SCOPE}`);
  console.error(`可用: ${Object.keys(SCOPES).join(' / ')}`);
  process.exit(2);
}

assertNodeModulesMatchPlatform();
assertNodeModulesMatchLockfile();
assertCoreIsFromThisCheckout({ requireDist: false });
reportBranchBase();

for (const shard of SCOPES[SCOPE]) {
  for (const [label, commandLine, options] of SHARDS[shard]) {
    const ok = runStep(label, commandLine, { ...options, exitOnFail: !options?.upstreamDrift });
    if (!ok) {
      // 只有标了 upstreamDrift 的步骤会走到这里（其余步骤 runStep 已 exit）
      const verdict = classifyExpoFailure();
      if (verdict.drift) {
        console.warn([
          '',
          '⚠ ' + label + ' 未通过，但判定为上游漂移，不拦本次验证：' + verdict.why,
          '  处置：与本改动无关时照常提交（这是 ADR 2026-09-29-dependency-update-governance 记过的固有不稳定源）；',
          '        要修就单独一票跑 npx expo install --fix，别混进本 PR。',
          '',
        ].join('\n'));
        continue;
      }
      console.error('✗ ' + label + ' 失败，且不是上游漂移：' + verdict.why);
      process.exit(1);
    }
    // 构建后立刻自证：消费者解析到的那份 dist 就是刚构建的这份（#521 的 junction 陷阱）
    if (label === 'core:build') assertCoreIsFromThisCheckout({ requireDist: true });
  }
}

console.log(`✓ verify passed (${SCOPE})`);
