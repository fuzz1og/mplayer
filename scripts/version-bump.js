/**
 * version-bump.js — Unified version number manager.
 *
 * Canon source: root package.json "version"
 * Syncs to: packages/mobile/app.json, android/build.gradle, mobile/package.json, core/package.json
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

// Which files to sync, each with a read/write strategy
const TARGETS = [
  // Root package.json (canon)
  {
    file: 'package.json',
    readVersion: (data) => data.version,
    writeVersion: (data, v) => { data.version = v; },
  },
  // Mobile app.json (expo.version)
  {
    file: 'packages/mobile/app.json',
    readVersion: (data) => data.expo?.version,
    writeVersion: (data, v) => { if (data.expo) data.expo.version = v; },
  },
  // Mobile workspace package.json
  {
    file: 'packages/mobile/package.json',
    readVersion: (data) => data.version,
    writeVersion: (data, v) => { data.version = v; },
  },
  // Core workspace package.json
  {
    file: 'packages/core/package.json',
    readVersion: (data) => data.version,
    writeVersion: (data, v) => { data.version = v; },
  },
];

// Android build.gradle — special handling (gradle DSL, not JSON)
const GRADLE_FILE = 'packages/mobile/android/app/build.gradle';
// Regex for versionName "x.y.z"
const VERSION_NAME_RE = /(versionName\s+)"(\d+\.\d+\.\d+)"/;
// Regex for versionCode <integer>
const VERSION_CODE_RE = /(versionCode\s+)(\d+)/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, filePath), 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(path.join(ROOT, filePath), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readGradle() {
  return fs.readFileSync(path.join(ROOT, GRADLE_FILE), 'utf8');
}

function writeGradle(content) {
  fs.writeFileSync(path.join(ROOT, GRADLE_FILE), content, 'utf8');
}

function parseVersion(str) {
  const parts = str.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2], raw: str };
}

/**
 * Read current versions from all targets.
 * Returns { entries: [{label, file, version, raw}], canon: parseVersion(...) }
 */
function readAll() {
  const canon = readJson('package.json');
  const canonV = parseVersion(canon.version);
  const entries = [];

  for (const t of TARGETS) {
    const data = readJson(t.file);
    const ver = t.readVersion(data);
    entries.push({
      label: t.file.replace(/^packages\//, ''),
      file: t.file,
      version: ver,
      raw: data,
    });
  }

  // Gradle
  const gradleContent = readGradle();
  const vnMatch = gradleContent.match(VERSION_NAME_RE);
  const vcMatch = gradleContent.match(VERSION_CODE_RE);
  entries.push({
    label: 'android/build.gradle',
    file: GRADLE_FILE,
    version: vnMatch ? vnMatch[2] : null,
    versionCode: vcMatch ? parseInt(vcMatch[2], 10) : null,
    raw: gradleContent,
  });

  return { canon: canonV, canonRaw: canon, entries };
}

function printSummary(all, newVersion) {
  console.log(`\n  Version status:`);
  console.log(`  root package.json  → ${all.canon.raw}${newVersion ? ` → ${newVersion}` : ''}`);
  for (const e of all.entries) {
    const arrow = newVersion && e.file !== GRADLE_FILE ? ` → ${newVersion}` : '';
    const vc = e.versionCode !== undefined ? `  (versionCode: ${e.versionCode})` : '';
    console.log(`  ${e.label.padEnd(22)} ${e.version || '—'}${arrow}${vc}`);
  }
}

function runCheck() {
  const all = readAll();
  const canon = all.canon.raw;
  let ok = true;

  for (const e of all.entries) {
    if (e.version !== canon) {
      console.log(`  MISMATCH: ${e.label} has "${e.version}", canon is "${canon}"`);
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
  const oldVer = all.canon.raw;

  // 1. Update root package.json
  all.canonRaw.version = newVer;
  writeJson('package.json', all.canonRaw);

  // 2. Update JSON targets
  for (const e of all.entries) {
    if (e.file === GRADLE_FILE) continue; // handled separately
    // Skip if file doesn't have writable target
    const t = TARGETS.find(t => t.file === e.file);
    if (!t) continue;
    t.writeVersion(e.raw, newVer);
    writeJson(e.file, e.raw);
  }

  // 3. Update Gradle: versionName + versionCode
  let gradleContent = all.entries.find(e => e.file === GRADLE_FILE).raw;

  // versionName
  gradleContent = gradleContent.replace(VERSION_NAME_RE, (_, prefix) => {
    return `${prefix}"${newVer}"`;
  });

  // versionCode: increment by 1 (always)
  const oldCode = all.entries.find(e => e.file === GRADLE_FILE).versionCode || 1;
  const newCode = oldCode + 1;
  gradleContent = gradleContent.replace(VERSION_CODE_RE, (_, prefix) => {
    return `${prefix}${newCode}`;
  });

  writeGradle(gradleContent);

  // 4. Summary
  console.log(`\n  ✓ Version bumped: ${oldVer} → ${newVer}`);
  printSummary(all, newVer);
  console.log(`  versionCode: ${oldCode} → ${newCode}\n`);
  console.log(`  Staged changes:`);
  console.log(`    package.json`);
  for (const e of all.entries) {
    console.log(`    ${e.file}`);
  }
  console.log(`    packages/mobile/android/app/build.gradle`);
}

function runDry() {
  const all = readAll();
  console.log(`  Current versions:`);
  for (const e of all.entries) {
    if (e.versionCode !== undefined) {
      console.log(`  ${e.label.padEnd(22)} ${e.version}  (versionCode: ${e.versionCode})`);
    } else {
      console.log(`  ${e.label.padEnd(22)} ${e.version}`);
    }
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
