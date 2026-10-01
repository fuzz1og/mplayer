/**
 * version-bump.js 的执行级测试（#524）。
 *
 * 用 node:test 跑（`node --test scripts/__tests__/version-bump.test.js`），**零依赖、
 * 零真实仓库写入**：每个用例把 scripts/version-bump.js 连同一份 5 件套 fixture 复制进
 * 临时沙箱，在沙箱里起子进程——断言的是「人真正跑脚本时发生什么」，不是内部函数。
 *
 * 回归对象：bump 必须同步 package-lock.json 的 workspace 条目（packages/mobile、
 * packages/core），且**只动版本号字面量**——不能整份重序列化 lock（那会重排整个
 * 文件、产出与改动无关的巨量 diff，见 #523 的 worktree 噪音）。
 *
 * 子进程入参用显式 flag：node --test 会把裸的 --check / 1.9.0 当成自己的参数吞掉，
 * 所以走 `-- --check` / `-- --bump 1.9.0`，本文件里 parseArgs 再翻译回去。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFESTS = [
  'package.json',
  'package-lock.json',
  'packages/mobile/app.json',
  'packages/mobile/package.json',
  'packages/core/package.json',
];

// 有漂移的基准：顶层/manifest 都是 1.8.5，lock 的 workspace 条目落后在 1.8.4
const CANON = '1.8.5';
const DRIFTED_WORKSPACES = ['packages/core', 'packages/mobile'];

/** 建沙箱：manifest 5 件套 + 被测脚本 + 一个 workspace lock 落后 1 个版本。 */
function makeSandbox() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mplayer-version-bump-'));
  fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'version-bump.js'),
    path.join(sandbox, 'scripts', 'version-bump.js')
  );
  for (const rel of MANIFESTS) {
    const from = path.join(REPO_ROOT, rel);
    const to = path.join(sandbox, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  // 把 workspace 条目写成落后一个版本（模拟 #524 的现状）
  const lockPath = path.join(sandbox, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const stale = CANON.replace(/(\d+)$/, (n) => String(Number(n) - 1));
  for (const key of DRIFTED_WORKSPACES) {
    assert.ok(lock.packages[key], `fixture 期望 lock 里有 ${key}`);
    lock.packages[key].version = stale;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');

  return { sandbox, lockPath, stale };
}

/** 在沙箱里跑被测脚本；args 与真实 CLI 同形（--check / --bump X / 空 = dry-run）。 */
function runScript(sandbox, args) {
  const res = spawnSync(
    process.execPath,
    [path.join(sandbox, 'scripts', 'version-bump.js'), ...args],
    { encoding: 'utf8', cwd: sandbox }
  );
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/** 测试进程自己被 --test 调用时的入参（见文件头：必须走 `--` 之后的 flag）。 */
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    check: { type: 'boolean' },
    bump: { type: 'string' },
  },
  allowPositionals: true,
});

/** 把测试自己的 CLI flag 翻成被测脚本的 CLI flag。 */
function scriptArgs() {
  if (values.check) return ['--check'];
  if (values.bump) return [values.bump];
  return [];
}


function readLock(sandbox) {
  return JSON.parse(fs.readFileSync(path.join(sandbox, 'package-lock.json'), 'utf8'));
}

const cleanup = (sandbox) => fs.rmSync(sandbox, { recursive: true, force: true });

/** 比 diff 时剥掉 CR，兼容
 * CRLF 检出（本仓 lock 就是 CRLF）。 */
const stripCR = (s) => s.replace(/\r\n/g, '\n');

test('--check 在 lock 的 workspace 条目落后时 MISMATCH 并退出 1', () => {
  const { sandbox, stale } = makeSandbox();
  try {
    const res = runScript(sandbox, ['--check']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /MISMATCH: lock packages\/core/);
    assert.match(res.stdout, /MISMATCH: lock packages\/mobile/);
    assert.ok(res.stdout.includes(stale), 'MISMATCH 行应带上落后版本号');
  } finally {
    cleanup(sandbox);
  }
});

test('bump 同步 lock 的 workspace 条目（#524 的回归点）', () => {
  const { sandbox } = makeSandbox();
  try {
    const res = runScript(sandbox, ['1.9.0']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const lock = readLock(sandbox);
    assert.equal(lock.packages['packages/core'].version, '1.9.0');
    assert.equal(lock.packages['packages/mobile'].version, '1.9.0');
    // 顶层与 packages[''] 保持原有同步行为
    assert.equal(lock.version, '1.9.0');
    assert.equal(lock.packages[''].version, '1.9.0');

    assert.equal(JSON.parse(fs.readFileSync(path.join(sandbox, 'package.json'), 'utf8')).version, '1.9.0');
    for (const rel of ['packages/core/package.json', 'packages/mobile/package.json']) {
      assert.equal(JSON.parse(fs.readFileSync(path.join(sandbox, rel), 'utf8')).version, '1.9.0');
    }
    const app = JSON.parse(fs.readFileSync(path.join(sandbox, 'packages/mobile/app.json'), 'utf8'));
    assert.equal(app.expo.version, '1.9.0');
  } finally {
    cleanup(sandbox);
  }
});

test('bump 对 lock 的改动只有版本号（不整份重序列化）', () => {
  const { sandbox } = makeSandbox();
  try {
    const before = fs.readFileSync(path.join(sandbox, 'package-lock.json'), 'utf8');
    runScript(sandbox, ['1.9.0']);
    const after = fs.readFileSync(path.join(sandbox, 'package-lock.json'), 'utf8');
    const beforeLines = stripCR(before).split('\n');
    const afterLines = stripCR(after).split('\n');

    assert.equal(afterLines.length, beforeLines.length, '行数必须一致（不允许整份重排）');
    const changed = beforeLines.map((l, i) => (l === afterLines[i] ? null : i)).filter((i) => i !== null);
    // 顶层 version + packages[''] + N 个 workspace 条目，每条只改一行
    assert.equal(changed.length, 2 + DRIFTED_WORKSPACES.length, `改动行数异常: ${changed.length}`);
    for (const i of changed) {
      assert.match(afterLines[i], /^\s*"version": "/, `第 ${i + 1} 行不是版本号: ${afterLines[i]}`);
    }
  } finally {
    cleanup(sandbox);
  }
});

test('lock 缺 workspace 条目时 bump 报错退出 1（不静默写坏）', () => {
  const { sandbox, lockPath } = makeSandbox();
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    delete lock.packages['packages/mobile'];
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');

    const res = runScript(sandbox, ['1.9.0']);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /package-lock\.json/);
  } finally {
    cleanup(sandbox);
  }
});

// ── 下面三条覆盖补齐后的闭环行为（bump 后自洽 / 一致时绿灯 / flag 契约） ──

test('bump 后 --check 通过（脏 lock 不再残留）', () => {
  const { sandbox } = makeSandbox();
  try {
    runScript(sandbox, ['1.9.0']);
    const res = runScript(sandbox, ['--check']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
  } finally {
    cleanup(sandbox);
  }
});

test('--check 全一致时退出 0', () => {
  const { sandbox } = makeSandbox();
  try {
    runScript(sandbox, ['1.8.6']);
    const res = runScript(sandbox, ['--check']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
  } finally {
    cleanup(sandbox);
  }
});

// 守卫：本文件被 --test 调用时必须显式带 flag，否则上面这些断言会整体失去意义。
// 用 --check 跑（验红路径）时这条自动跳过，不算失败；用 --bump 跑（验绿路径）时它必须通过。
const guard = values.check || values.bump ? test : test.skip;
guard('测试自身的 CLI 契约（--check / --bump）', () => {
  assert.deepEqual(scriptArgs(), values.check ? ['--check'] : [values.bump]);
});
