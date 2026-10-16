#!/usr/bin/env node
/**
 * docs-gate.mjs — 文档与源码的三条机械门禁（#523 / #647）。① shim 指针：活文档出现 scripts/X.sh（有同名 .mjs）必须同句标 shim/兼容/等价写法；
 * ② 文件表漂移：配置目录的每个实现文件都要在 architecture.md 出现（规则 1/2 有意不扫 .github/workflows/**、历史存档、*.test.*）；
 * ③ 敏感内容扫描反过来**必须扫历史存档与源码**（.ts/.tsx/.kt…），命中一律打码输出，见 checkSensitiveContent。
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

/**
 * 源码敏感扫描专用遍历：**不跳过** `__tests__` / `*.test.*`（测试里会抄一份真值），
 * 只跳过生成物与依赖目录。与 `walkFiles` 分开，避免改动规则 2 已在用的语义。
 */
function walkSensitiveSource(absDir, out = []) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (!SENSITIVE_SOURCE_SKIP_DIRS.has(entry.name)) walkSensitiveSource(abs, out);
    } else if (SENSITIVE_SOURCE_EXT.some((x) => entry.name.endsWith(x))) {
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

/**
 * 规则 3：文档不得出现真实个人信息 / 会话凭证（#526）。
 * 与规则 1/2 相反：**本规则必须扫历史存档**（docs/{adr,research,specs,wayfinder}）。
 * 命中一律**打码**输出 —— 门禁把泄露值打进 CI 日志，等于再泄露一次。
 */
const SENSITIVE_ROOTS = ['AGENTS.md', 'README.md', 'GLOSSARY.md', 'CODING_STANDARDS.md', 'SECURITY.md', 'docs', '.github', '.agents'];
const SENSITIVE_EXT = ['.md', '.yml', '.yaml', '.json'];

/**
 * 源码也必须扫（#647）：规则 3 起初只扫文档类扩展名，源码 `.ts/.tsx/.kt` 完全不看，而 AGENTS.md 明写「tier3 订阅地址、API key 不入库」——
 * 那些最可能就写在源码里（实测盲区：假密钥放 `docs/` 报红、放 `packages/core/src/` 无声通过）。与文档扫描的差别：**不跳过 `__tests__`
 * 与 `*.test.*`**（测试里同样会抄一份真值），只跳 `node_modules/dist/coverage` 等生成物。
 */
const SENSITIVE_SOURCE_ROOTS = ['src', 'packages', 'scripts', 'e2e', 'resources', 'public', 'examples'];
const SENSITIVE_SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.kt', '.java'];
const SENSITIVE_SOURCE_SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '.git', '.expo', 'build', '.gradle']);

/**
 * 已知的**公开**第三方字面量：形状命中规则，但不是本仓独有的凭据，列入豁免。
 * 每条必须写清「为什么它不是秘密」——没有正当理由的条目应改成从环境/配置读入。
 */
const SENSITIVE_ALLOW = [
  {
    value: '0b50b02fd0d73a9c4c8c3a781c30845f',
    reason: '千千静听(91q)网页端签名盐，出自开源项目 musicdl 的 qianqian.py，非本仓凭据（qianqianDirect.ts 注释已注明出处）',
  },
];
/** 占位符 / 说明性写法：命中这些形态就不算真值（含「已打码」的占位形式）。 */
const PLACEHOLDER = /<[^>]*>|\$\{|\{\{|\.\.\.|xxx|your[_-]|example|placeholder|redacted|占位|打码/i;

const SENSITIVE_RULES = [
  { // 本次事故就是这条抓的：值经 base64 编码，grep「手机号」永远看不见
    name: 'base64 手机号',
    re: /\b(?:msisdn|phone|mobile|tel)\b\s*[:=]\s*["']?([A-Za-z0-9+/]{8,}={0,2})["']?/gi,
    value: (m) => m[1],
    hit: (v) => {
      try {
        const dec = Buffer.from(v + '='.repeat((4 - (v.length % 4)) % 4), 'base64').toString('utf8');
        return /^1[3-9]\d{9}$/.test(dec);
      } catch { return false; }
    },
  },
  { name: '裸手机号', re: /(?<![\w])1[3-9]\d{9}(?![\w])/g, value: (m) => m[0], hit: () => true },
  { name: '会话 sid', re: /sid=USS[0-9a-f]{16,}/gi, value: (m) => m[0], hit: () => true },
  { name: 'Bearer 凭据', re: /Bearer\s+([A-Za-z0-9._-]{24,})/g, value: (m) => m[1], hit: () => true },
  { name: '密钥字面量', re: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']([A-Za-z0-9_+/=-]{16,})["']/gi, value: (m) => m[1], hit: () => true },
];

/** 打码：门禁的输出本身不能成为新的泄露点。 */
function mask(v) {
  if (v.length <= 6) return v[0] + '*'.repeat(v.length - 1);
  return v.slice(0, 2) + '*'.repeat(Math.min(8, v.length - 4)) + v.slice(-2);
}

/** 规则 3：敏感内容扫描（**含**历史存档与文档目录下的未跟踪文件 —— git add -A 的风险面）。 */
function checkSensitiveContent() {
  const violations = [];
  const files = [];
  for (const rel of SENSITIVE_ROOTS) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isFile()) files.push(abs);
    else walkFiles(abs, SENSITIVE_EXT, files);
  }
  for (const rel of SENSITIVE_SOURCE_ROOTS) {
    const abs = path.join(ROOT, rel);
    if (existsSync(abs)) walkSensitiveSource(abs, files);
  }
  for (const file of files) {
    const rel = toRel(file);
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const rule of SENSITIVE_RULES) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line)) !== null) {
          const raw = rule.value(m);
          if (!raw || PLACEHOLDER.test(raw) || PLACEHOLDER.test(m[0])) continue;
          if (SENSITIVE_ALLOW.some((a) => a.value === raw)) continue;
          if (!rule.hit(raw)) continue;
          violations.push(rel + ':' + (i + 1) + '  [' + rule.name + '] ' + mask(raw));
        }
      }
    });
  }
  return { violations, scanned: files.length };
}

const scriptsDir = path.join(ROOT, 'scripts');
const shimBases = readdirSync(scriptsDir)
  .filter((n) => n.endsWith('.sh') && existsSync(path.join(scriptsDir, n.replace(/\.sh$/, '.mjs'))))
  .map((n) => n.replace(/\.sh$/, ''));

const shim = checkShimPointers(shimBases);
const table = checkTableDrift();
const sensitive = checkSensitiveContent();
const violations = [...shim.violations, ...table.violations, ...sensitive.violations];

if (violations.length > 0) {
  console.error('✗ 文档门禁未过（' + violations.length + ' 条）：\n');
  for (const v of violations) console.error('  ' + v);
  console.error([
    '',
    '  处置：',
    '    - 「把 shim 当命令推荐」→ 改成 npm run <script>；.sh 只作等价写法，同句带上 shim / 兼容 / 等价写法',
    '    - 「未记录」→ 在 ' + TABLE_DOC + ' 补上该文件，或在 docs-gate.mjs 的 TABLE_ALLOW 写明为什么不必记',
    '    - 「[敏感内容]」→ 把真值换成占位符（如 <base64(手机号)>），或把该文件移出仓库（见 AGENTS.md「敏感信息不入库」）',
  ].join('\n'));
  process.exit(1);
}
console.log('✓ 文档门禁：shim 指针 ' + shim.compliant + ' 行合规（' + shimBases.length + ' 个 shim），文件表 ' + table.checked + ' 个文件已记录，敏感扫描 ' + sensitive.scanned + ' 个文件');
