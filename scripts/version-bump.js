/**
 * version-bump.js — Unified version number manager.
 *
 * Canon source: root package.json "version"
 *
 * Syncs to (5 files / 8 fields):
 *   package.json                      version
 *   package-lock.json                 version + packages[""].version
 *                                     + packages["<workspace dir>"].version × N
 *   packages/mobile/app.json          expo.version + expo.android.versionCode
 *   packages/mobile/package.json      version
 *   packages/core/package.json        version
 *
 * Android versionCode is stored in app.json (standard Expo practice).
 * expo prebuild generates build.gradle from app.json at build time.
 *
 * package-lock.json 用**定向文本替换**写（不做整份 JSON 重序列化）：#524 的验收
 * 要求 bump 后 lock 的 diff「只有版本号」，而整份 JSON.stringify 重写会重排整个文件、
 * 产出与本次改动无关的巨量 diff（#523 的 worktree 里出现过这种噪音）。每条替换都
 * 断言「命中且仅命中一次」，命中数不符即报错退出——绝不静默写坏 lock。
 *
 * Usage:
 *   node scripts/version-bump.js          # Dry-run: show current versions
 *   node scripts/version-bump.js 1.4.0    # Set version across all locations
 *   node scripts/version-bump.js --check  # Verify all locations match canon
 *
 * Exit codes:
 *   0 = ok
 *   1 = --check found mismatch / version bump 写入失败
 *   2 = invalid version argument
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const LOCKFILE = 'package-lock.json';
const LOCK_WS_PREFIX = 'packages/';

/** 读根 package.json 的 workspaces 声明的本地包目录（对象写法取 packages）。 */
function workspaceDirs(manifest) {
  const raw = manifest && manifest.workspaces;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw.packages) return raw.packages;
  return [];
}

/**
 * workspaces 里的『packages/<名>』单层 glob → 实际子包目录名列表。
 *
 * workspaces 声明的是 glob（本仓是 'packages/*'），不能直接当成目录名——必须展开：
 * 列出 packages/ 下的真实目录，取其中有 package.json 的（与 npm 的判定同构）。
 * 更深一层的嵌套 glob 交给 npm 自己解析，本脚本不猜（猜错会写到无关条目）。
 */
function childWorkspaceNames() {
  const dirs = workspaceDirs(readJson('package.json'));
  const simple = dirs.every((d) => typeof d === 'string'
    && d.startsWith(LOCK_WS_PREFIX)
    && !d.slice(LOCK_WS_PREFIX.length).includes('/')
    && d.slice(LOCK_WS_PREFIX.length).length > 0);
  if (!simple) return [];

  // glob（如 'packages/*'）展开成真实目录：有 package.json 的子目录即一个 workspace 包
  const parent = path.join(ROOT, LOCK_WS_PREFIX);
  let entries = [];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(parent, e.name, 'package.json')))
    .map((e) => e.name)
    .sort();
}

/**
 * 一个 workspace 目录对应一条 lock 派生条目（只在检查期出现，标签可区分）。
 * 它的 version 由 readAll 用与写入端同一套定位（lockVersionAnchors）读出后注入，
 * 所以这里不出 read/write。
 */
function lockWorkspaceTarget(dir) {
  return { file: LOCKFILE, checkOnly: true, label: 'lock ' + LOCK_WS_PREFIX + dir };
}

// Files to sync, each with read/write strategy
const BASE_TARGETS = [
  // Root package.json (canon)
  {
    file: 'package.json',
    read: (data) => ({ version: data.version }),
    write: (data, v) => { data.version = v; },
  },
  // Root package-lock.json 的 JSON 字段（顶层 + packages[""]）；workspace 条目见 writeLockfileWorkspaceVersions
  {
    file: LOCKFILE,
    read: (data) => ({ version: data.version }),
    write: (data, v) => {
      data.version = v;
      if (data.packages && data.packages['']) data.packages[''].version = v;
    },
  },
  // Mobile app.json (expo.version + android.versionCode for Expo)
  {
    file: 'packages/mobile/app.json',
    read: (data) => ({
      version: data.expo?.version,
      versionCode: data.expo?.android?.versionCode,
    }),
    write: (data, ver, vc) => {
      if (data.expo) {
        data.expo.version = ver;
        if (data.expo.android) data.expo.android.versionCode = vc;
      }
    },
  },
  // Mobile workspace package.json
  {
    file: 'packages/mobile/package.json',
    read: (data) => ({ version: data.version }),
    write: (data, v) => { data.version = v; },
  },
  // Core workspace package.json
  {
    file: 'packages/core/package.json',
    read: (data) => ({ version: data.version }),
    write: (data, v) => { data.version = v; },
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, filePath), 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(path.join(ROOT, filePath), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 读原文（lock 用；读、改一次、写一次，不做整份重序列化）。 */
function readText(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8');
}

function writeText(filePath, text) {
  fs.writeFileSync(path.join(ROOT, filePath), text, 'utf8');
}

function parseVersion(str) {
  const parts = str.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2], raw: str };
}

/**
 * package-lock.json 的版本写入。
 *
 * 用**字符串感知的括号深度扫描**定位每个要改的 version：
 * 锚点键（顶层 version / packages[""] / packages["<workspace>"]）所处深度 + 1 的那一层，
 * 取其后第一个 `"version": "…"`。扫描跳过字符串字面量，所以依赖项名里出现 {} 也不会错；
 * 取值只改「值」这一小段，缩进与行尾（CRLF/LF）原样保留——diff 里只有版本号。
 */

/**
 * 在 [from, to) 区间里找第一个 `"version": "<值>"`，返回其**值**（含引号）的跨度。
 * 区间由调用方限定，所以不会串到邻居的 version。
 */
function findVersionValue(text, from, to) {
  const re = /"version":(\s*)"([^"]*)"/g;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m || m.index >= to) return null;
  const valueEnd = m.index + m[0].length;
  return { value: m[2], valueStart: valueEnd - (m[2].length + 2), valueEnd };
}

/**
 * 要改的条目：锚点键的原始写法（workspace 条目用 JSON.stringify 转义，两种转义写法都能命中）
 * 与下一个锚点之间的区间里，找该锚点深度 + 1 层的 version。
 */
function lockVersionAnchors(text, workspaceNames) {
  const anchors = [{ what: '顶层 version', key: '"version":' }];
  anchors.push({ what: 'packages[""]', key: '"": {' });
  for (const name of workspaceNames) {
    anchors.push({ what: LOCK_WS_PREFIX + name, key: JSON.stringify(LOCK_WS_PREFIX + name) + ': {' });
  }

  const located = anchors.map((a) => {
    const at = text.indexOf(a.key);
    if (at < 0) throw new Error(`package-lock.json: 期望 ${a.what} 命中 1 次，实际 0 次`);
    return { what: a.what, at };
  });

  return located.map((a, i) => {
    const end = i + 1 < located.length ? located[i + 1].at : text.length;
    const hit = findVersionValue(text, a.at, end);
    if (!hit) {
      throw new Error(`package-lock.json: 期望 ${a.what} 之后（同层）的 version 命中 1 次，实际 0 次`);
    }
    return { what: a.what, ...hit };
  });
}

/** 把 lock 的顶层 version、packages[""] 与每个 workspace 条目的 version 定向改成 v。 */
function writeLockfileWorkspaceVersions(v, workspaceNames) {
  const text = readText(LOCKFILE);
  const hits = lockVersionAnchors(text, workspaceNames);

  // 从后往前替换，保证前面的下标仍然有效
  let next = text;
  for (const hit of [...hits].sort((a, b) => b.valueStart - a.valueStart)) {
    next = next.slice(0, hit.valueStart) + JSON.stringify(v) + next.slice(hit.valueEnd);
  }

  if (next === text) {
    throw new Error(`package-lock.json: 没有任何 version 被改写（期望 ${hits.length} 处）`);
  }
  writeText(LOCKFILE, next);
  return hits.map((h) => h.what);
}

/** --check 也读同一组位置，保证「改了」与「查了」永远是同一批条目。 */
function readLockVersions(workspaceNames) {
  const text = readText(LOCKFILE);
  return new Map(lockVersionAnchors(text, workspaceNames).map((h) => [h.what, h.value]));
}

function readAll() {
  const root = readJson('package.json');
  const canonV = parseVersion(root.version);
  const entries = [];

  const workspaceNames = childWorkspaceNames();
  const targets = BASE_TARGETS.concat(workspaceNames.map(lockWorkspaceTarget));

  // --check 必须看**同一个位置**的版本：与写入端共用 lockVersionAnchors
  const lockVersions = readLockVersions(workspaceNames);

  for (const t of targets) {
    const data = readJson(t.file);
    const e = t.read ? t.read(data, root) : {};
    entries.push({
      label: t.label || t.file.replace(/^packages\//, ''),
      file: t.file,
      checkOnly: t.checkOnly === true,
      // 检查期条目：label 形如 'lock packages/core'，map 的键是不带 'lock ' 的条目名
      version: e.version !== undefined ? e.version : lockVersions.get(t.label.replace(/^lock /, '')),
      versionCode: e.versionCode,
      raw: data,
    });
  }

  return { canon: canonV, root, workspaceNames, entries };
}

function printSummary(all, ver, vc) {
  console.log('\n  Version status:');
  console.log(`  root package.json  → ${all.canon.raw}${ver ? ` → ${ver}` : ''}`);
  for (const e of all.entries) {
    if (e.checkOnly) continue;
    let line = `  ${e.file.replace(/^packages\//, '').padEnd(22)} ${e.version || '—'}`;
    if (ver && e.versionCode !== undefined) {
      line += `  → ${ver}`;
    }
    if (e.versionCode !== undefined) {
      line += `  (versionCode: ${e.versionCode}`;
      if (vc) line += ` → ${vc}`;
      line += ')';
    }
    console.log(line);
  }
}

function runCheck() {
  const all = readAll();
  const canon = all.canon.raw;
  let ok = true;

  for (const e of all.entries) {
    if (e.version !== canon) {
      console.log(`  MISMATCH: ${e.label} version "${e.version}", canon "${canon}"`);
      ok = false;
    } else {
      console.log(`  OK:        ${e.label} = ${e.version}`);
    }
  }
  process.exit(ok ? 0 : 1);
}

function runBump(newVer) {
  const parsed = parseVersion(newVer);
  if (!parsed) {
    console.error(`  Invalid version "${newVer}". Expected semver like 1.4.0`);
    process.exit(2);
  }

  const all = readAll();

  // Find current versionCode from app.json
  const appJsonEntry = all.entries.find(e => e.file === 'packages/mobile/app.json');
  const oldCode = appJsonEntry?.versionCode || 1;
  const newCode = oldCode + 1;

  // Update the JSON manifests
  for (const e of all.entries) {
    if (e.checkOnly) continue;
    const t = BASE_TARGETS.find(t => t.file === e.file);
    if (!t) continue;
    if (e.versionCode !== undefined) {
      t.write(e.raw, newVer, newCode);
    } else {
      t.write(e.raw, newVer);
    }
    writeJson(e.file, e.raw);
  }

  // package-lock.json：workspace 条目做定向文本替换（diff 只含版本号）
  const workspaceNames = childWorkspaceNames(all.root);
  const touched = writeLockfileWorkspaceVersions(newVer, workspaceNames);

  console.log(`\n  ✓ Version bumped: ${all.canon.raw} → ${newVer}`);
  printSummary(all, newVer, newCode);
  console.log(`  versionCode: ${oldCode} → ${newCode}`);
  console.log(`  package-lock.json 定向更新: ${touched.join(', ')}`);
  console.log('\n  Staged changes:');
  for (const e of all.entries) {
    if (!e.checkOnly) console.log(`    ${e.file}`);
  }
  console.log(`    ${LOCKFILE} (workspace 条目 × ${workspaceNames.length})`);
}

function runDry() {
  const all = readAll();
  console.log('  Current versions:');
  for (const e of all.entries) {
    const line = `  ${e.label.padEnd(22)} ${e.version || '—'}`;
    const vc = e.versionCode !== undefined ? `  (versionCode: ${e.versionCode})` : '';
    console.log(line + vc);
  }
  console.log(`\n  Canon source: package.json version = ${all.canon.raw}`);
}

// === Main ===
const arg = process.argv[2];

if (arg === '--check') {
  runCheck();
} else if (arg && !arg.startsWith('-')) {
  try {
    runBump(arg);
  } catch (err) {
    console.error(`  ✗ version bump 失败: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
} else {
  runDry();
}
