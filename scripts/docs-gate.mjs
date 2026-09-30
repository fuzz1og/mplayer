#!/usr/bin/env node
/**
 * docs-gate.mjs — 活文档的两条机械门禁（#523）。
 *
 * 活文档里最容易腐烂的两处恰好都是机械可判的，所以交给脚本，不写进评审标准：
 *
 * 1. shim 指针：scripts/*.sh 现在全是两行 shim（各自 exec node 同名 .mjs，#500 / #502）。
 *    把 .sh 当入口推荐，等于让读者在 Windows 上撞 WSL 的 Linux bash —— 这正是 #500 修掉、
 *    却在 release skill 里残留过一次的坑。规则：活文档里出现 scripts/X.sh（存在同名 .mjs）
 *    的行，必须同句标注 shim / 兼容 / 等价写法。
 * 2. 文件表漂移：docs/agents/architecture.md 的文件表靠人肉核对，1.8.5 复盘一次就漏了 10 处
 *    （binCacheBudget / fsAsync / outboundGate / 移动端 6 个 services …）。规则：配置目录里的
 *    每个实现文件名都必须在该文档出现过。
 *
 * 有意不扫：.github/workflows/**（有意走 shim，顺带把 shim 本身验证掉）、历史存档
 * docs/{adr,research,specs,wayfinder}（不回改）、*.test.* 与 TABLE_ALLOW（有意不记的实现）。
 *
 * 用法: node scripts/docs-gate.mjs    （static 分片的第一步，CI 的 check job 顺带覆盖）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** 活文档：会被当轮读、也必须与实现一致。目录递归取 .md。 */
const LIVING_DOCS = ['AGENTS.md', 'README.md', 'GLOSSARY.md', 'CODING_STANDARDS.md', 'docs/agents', '.agents', '.github'];
/** 同句出现这些词，才算「说明了它是 shim」，而不是把它当命令推荐。 */
const SHIM_MARKER = /shim|兼容|等价写法/;

/**
 * 文件表门禁的根。aliases 是文档惯用的短名（playerStore -> player）。
 * 只收文档确实逐一枚举的目录 —— 用「等」带过的（components/、utils/、cache/）不进。
 */
const TABLE_ROOTS = [
  { dir: 'src/main', ext: ['.ts'] },
  { dir: 'src/renderer/services', ext: ['.ts'] },
  { dir: 'src/renderer/store', ext: ['.ts'] },
  { dir: 'packages/mobile/services', ext: ['.ts'] },
  { dir: 'packages/mobile/stores', ext: ['.ts'], aliases: ['Store'] },
  { dir: 'packages/mobile/hooks', ext: ['.ts'] },
  { dir: 'packages/core/src/api', ext: ['.ts'] },
  { dir: 'packages/core/src/shared', ext: ['.ts'] },
  { dir: 'packages/core/src/tier3', ext: ['.ts'] },
  { dir: 'packages/mobile/modules/native-player/android/src/main/java/expo/modules/mplayerplayer', ext: ['.kt'] },
];
const TABLE_DOC = 'docs/agents/architecture.md';
/** 有意不记进文件表的实现文件（repo 相对路径）。留空是常态；进这里要写明为什么。 */
const TABLE_ALLOW = new Set([]);

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', 'dist', '.git']);

function walkFiles(absDir, ext, out = []) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(abs, ext, out);
    } else if (ext.some((x) => entry.name.endsWith(x)) && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
      out.push(abs);
    }
  }
  return out;
}

function walkMarkdown(absPath, out = []) {
  if (!existsSync(absPath)) return out;
  if (statSync(absPath).isFile()) {
    if (absPath.endsWith('.md')) out.push(absPath);
    return out;
  }
  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    const abs = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkMarkdown(abs, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(abs);
    }
  }
  return out;
}

/** 规则 1：活文档不得把 shim 当命令推荐。 */
function checkShimPointers(shimBases) {
  const violations = [];
  let compliant = 0;
  for (const doc of LIVING_DOCS.flatMap((rel) => walkMarkdown(path.join(ROOT, rel)))) {
    const rel = toRel(doc);
    readFileSync(doc, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const base of shimBases) {
        if (!line.includes('scripts/' + base + '.sh')) continue;
        if (SHIM_MARKER.test(line)) compliant++;
        else violations.push(rel + ':' + (i + 1) + '  把 shim 当命令推荐：' + line.trim().slice(0, 100));
      }
    });
  }
  return { violations, compliant };
}

/** 规则 2：文件表的每个实现文件都要在架构文档里出现。 */
function checkTableDrift() {
  const doc = path.join(ROOT, TABLE_DOC);
  if (!existsSync(doc)) return { violations: ['缺少 ' + TABLE_DOC], checked: 0 };
  const text = readFileSync(doc, 'utf8');
  const violations = [];
  let checked = 0;
  for (const { dir, ext, aliases = [] } of TABLE_ROOTS) {
    const absDir = path.join(ROOT, dir);
    if (!existsSync(absDir)) {
      violations.push(dir + '  目录不存在（门禁配置过期）');
      continue;
    }
    for (const file of walkFiles(absDir, ext)) {
      const rel = toRel(file);
      if (TABLE_ALLOW.has(rel)) continue;
      checked++;
      const stem = path.basename(file, path.extname(file));
      const candidates = [stem, ...aliases.map((s) => (stem.endsWith(s) ? stem.slice(0, -s.length) : stem))];
      if (!candidates.some((name) => text.includes(name))) {
        violations.push(TABLE_DOC + '  未记录：' + rel);
      }
    }
  }
  return { violations, checked };
}

const scriptsDir = path.join(ROOT, 'scripts');
const shimBases = readdirSync(scriptsDir)
  .filter((n) => n.endsWith('.sh') && existsSync(path.join(scriptsDir, n.replace(/\.sh$/, '.mjs'))))
  .map((n) => n.replace(/\.sh$/, ''));

const shim = checkShimPointers(shimBases);
const table = checkTableDrift();
const violations = [...shim.violations, ...table.violations];

if (violations.length > 0) {
  console.error('✗ 文档门禁未过（' + violations.length + ' 条）：\n');
  for (const v of violations) console.error('  ' + v);
  console.error([
    '',
    '  处置：',
    '    - 「把 shim 当命令推荐」→ 改成 npm run <script>；.sh 只作等价写法，同句带上 shim / 兼容 / 等价写法',
    '    - 「未记录」→ 在 ' + TABLE_DOC + ' 补上该文件，或在 docs-gate.mjs 的 TABLE_ALLOW 写明为什么不必记',
  ].join('\n'));
  process.exit(1);
}
console.log('✓ 文档门禁：shim 指针 ' + shim.compliant + ' 行合规（' + shimBases.length + ' 个 shim），文件表 ' + table.checked + ' 个文件已记录');
