/**
 * version-bump.js — Unified version number manager.
 *
 * Canon source: root package.json "version"
 * Syncs to: packages/mobile/app.json (expo.version + android.versionCode),
 *           packages/mobile/package.json, packages/core/package.json
 *
 * Android versionCode is stored in app.json (standard Expo practice).
 * expo prebuild generates build.gradle from app.json at build time.
 *
 * Usage:
 *   node scripts/version-bump.js          # Dry-run: show current versions
 *   node scripts/version-bump.js 1.4.0    # Set version across all locations
 *   node scripts/version-bump.js --check  # Verify all locations match canon
 *
 * Exit codes:
 *   0 = ok
 *   1 = --check found mismatch
 *   2 = invalid version argument
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Files to sync, each with read/write strategy
const TARGETS = [
  // Root package.json (canon)
  {
    file: 'package.json',
    read: (data) => ({ version: data.version }),
    write: (data, v) => { data.version = v; },
  },
  // Root package-lock.json（顶层 + packages[""] 双处 version，与 package.json 保持同步）
  {
    file: 'package-lock.json',
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

function parseVersion(str) {
  const parts = str.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2], raw: str };
}

function readAll() {
  const canon = readJson('package.json');
  const canonV = parseVersion(canon.version);
  const entries = [];

  for (const t of TARGETS) {
    const data = readJson(t.file);
    const e = t.read(data);
    entries.push({
      label: t.file.replace(/^packages\//, ''),
      file: t.file,
      version: e.version,
      versionCode: e.versionCode,
      raw: data,
    });
  }

  return { canon: canonV, entries };
}

function printSummary(all, ver, vc) {
  console.log(`\n  Version status:`);
  console.log(`  root package.json  → ${all.canon.raw}${ver ? ` → ${ver}` : ''}`);
  for (const e of all.entries) {
    let line = `  ${e.label.padEnd(22)} ${e.version || '—'}`;
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

  // Update all targets
  for (const e of all.entries) {
    const t = TARGETS.find(t => t.file === e.file);
    if (!t) continue;
    if (e.versionCode !== undefined) {
      t.write(e.raw, newVer, newCode);
    } else {
      t.write(e.raw, newVer);
    }
    writeJson(e.file, e.raw);
  }

  console.log(`\n  ✓ Version bumped: ${all.canon.raw} → ${newVer}`);
  printSummary(all, newVer, newCode);
  console.log(`  versionCode: ${oldCode} → ${newCode}\n`);
  console.log(`  Staged changes:`);
  for (const e of all.entries) {
    console.log(`    ${e.file}`);
  }
}

function runDry() {
  const all = readAll();
  console.log(`  Current versions:`);
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
  runBump(arg);
} else {
  runDry();
}
