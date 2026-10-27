#!/usr/bin/env node
/**
 * design-lint.mjs — 组件内颜色/不透明度门禁（UI 重构指南 §9 + #318 审计）。
 * 桌面 P2（清账 187 hex，延后）逐项清理后把对应色值填进黑名单防回归，因此当前为空清单、恒通过——门
 * 禁随 P2 进度生效。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

// token 定义文件 = 设计系统色值唯一事实源，豁免（未来新增 palette 文件在此追加）
const MOBILE_ALLOW_FILES = new Set(['packages/mobile/theme/tokens.ts']);
const MOBILE_SCAN_DIRS = ['packages/mobile/components', 'packages/mobile/app'];

// 格式: [色值, 清理原因]，清一处填一处
const LEGACY_HEX = [];

/** 四组模式：label 进报错文案，source 交给 RegExp（String.raw 保留正则里的反斜杠） */
const PATTERNS = [
  { label: 'hex 色值', source: String.raw`['"]#[0-9a-fA-F]{3,8}['"]` },
  { label: 'rgb/rgba 字面量', source: String.raw`['"]rgba?\([0-9]` },
  { label: '命名色', source: String.raw`['"](white|black|red|green|blue|yellow|gray|grey|orange|purple|pink|brown|cyan|magenta)['"]` },
  { label: 'opacity 魔数', source: String.raw`opacity: 0\.[0-9]+` },
];

let failed = false;

/** 递归列文件（排序，保证同一份代码每次输出顺序一致；跳过 node_modules） */
function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') yield* walk(full); continue; }
    if (entry.isFile()) yield full;
  }
}

/**
 * 逐组模式扫描：命中即 fail；token 文件与 `design-lint: ok` 行豁免。
 * 与原 bash 一致——外层循环是「模式」，内层是文件与行。
 */
function scanMobile(label, source) {
  const re = new RegExp(source);
  for (const dir of MOBILE_SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = file.split(path.sep).join('/');
      if (MOBILE_ALLOW_FILES.has(rel)) continue;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      const rows = text.split(/\r?\n/);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!re.test(row)) continue;
        if (row.includes('design-lint: ok')) continue;
        const hit = row.match(re)?.[0] ?? '';
        console.log('  ✗ ' + rel + ':' + (i + 1) + ' 非 token ' + label + ': ' + hit + '（token 定义见 MOBILE_ALLOW_FILES；合法遗留加行尾注释 design-lint: ok 并写明原因）');
        failed = true;
      }
    }
  }
}

console.log('→ design-lint: mobile 严格模式（components/app，四类写法）');
for (const { label, source } of PATTERNS) scanMobile(label, source);

console.log('→ design-lint: desktop 黑名单模式（renderer，遗留 ' + LEGACY_HEX.length + ' 项）');
for (const [hex, reason] of LEGACY_HEX) {
  const re = new RegExp("['\"]" + hex + "['\"]");
  const hits = [];
  for (const file of walk('src/renderer')) {
    let text; try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const rows = text.split(/\r?\n/);
    for (let i = 0; i < rows.length; i++) if (re.test(rows[i])) hits.push(file + ':' + (i + 1));
  }
  if (hits.length > 0) {
    console.log('  ✗ 遗留色值 ' + hex + '（' + reason + '）：');
    for (const h of hits) console.log('      ' + h);
    failed = true;
  }
}


// ── 桌面端严格模式（#689）：四条硬规则，无存量白名单
// antd 引入 / 内联样式（自定义属性除外）/ 颜色字面量 / 字号字重圆角字面量
const DESKTOP_STRICT = process.argv.includes('--desktop-strict');
// 豁免：token 定义文件 + 音乐源品牌色唯一事实源（ADR 2026-08-23 规定源品牌色只在这里定义）。
// 测试文件不参与样式规则——测试替身里的内联样式是夹具，不是产品样式。
const DESKTOP_TOKEN_FILES = new Set([
  'src/renderer/styles/global.css',
  'src/renderer/constants/sourceConfig.ts',
]);
const DESKTOP_DESIGN_LINT_OK = 'design-lint: ok';

/** 每条规则一个判定，返回是否命中；命中后再按规则名分组输出。 */
const DESKTOP_RULES = [
  {
    id: 'antd',
    extensions: ['.ts', '.tsx'],
    test: (line) => /\bfrom\s+['"]antd['"]|require\(\s*['"]antd['"]/.test(line),
    hint: '禁止引入 antd，改用 src/renderer/ui 原语',
  },
  {
    id: 'inline-style',
    extensions: ['.tsx'],
    skipTests: true,
    test: (line) => /\bstyle=\{\{/.test(line) && !/\bstyle=\{\{\s*'--/.test(line),
    hint: "禁止内联样式，改类名或 style={{ '--x': v }} 自定义属性",
  },
  {
    id: 'color-literal',
    extensions: ['.ts', '.tsx', '.css'],
    // 只认「写成颜色」的形态：TS 里必须带引号，CSS 里必须在声明值位置。
    // 否则 issue 号（#280）与注释里的 #403 会被误判成 3 位色值。
    test: (line, ext) =>
      ext === '.css'
        ? /:[^;{}]*#[0-9a-fA-F]{3,8}\b/.test(line) || /:[^;{}]*rgba?\(\s*\d/.test(line)
        : /(['"`])#[0-9a-fA-F]{3,8}\1/.test(line) || /(['"`])rgba?\(\s*\d/.test(line),
    skipTests: true,
    hint: '禁止颜色字面量，改用 var(--token)（token 只在 global.css 定义）',
  },
  {
    id: 'type-literal',
    extensions: ['.ts', '.tsx', '.css'],
    skipTests: true,
    // 已引用 var(--…) 的声明不算字面量（如组合圆角 0 var(--radius-xs) var(--radius-xs) 0）
    test: (line) =>
      !line.includes('var(--') &&
      (/\b(fontSize|fontWeight|lineHeight|borderRadius)\s*:\s*['"]?\d/.test(line) ||
        /\b(font-size|font-weight|line-height|border-radius)\s*:\s*\d/.test(line)),
    hint: '禁止字号/字重/行高/圆角字面量，改用 var(--text-*/--weight-*/--radius-*)',
  },
];

function scanDesktopStrict() {
  if (!DESKTOP_STRICT) return;
  const offenders = new Map();
  for (const file of walk('src/renderer')) {
    const rel = file.split(path.sep).join('/');
    if (DESKTOP_TOKEN_FILES.has(rel)) continue;
    const ext = path.extname(file);
    if (!['.ts', '.tsx', '.css'].includes(ext)) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const rows = text.split(/\r?\n/);
    const isTest = rel.includes('/__tests__/');
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      if (raw.includes(DESKTOP_DESIGN_LINT_OK)) continue;
      // 注释里的 issue 号与说明不参与判定（保留 https:// 里的 //）
      const row = raw.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const rule of DESKTOP_RULES) {
        if (!rule.extensions.includes(ext)) continue;
        if (rule.skipTests && isTest) continue;
        if (!rule.test(row, ext)) continue;
        if (!offenders.has(rule.id)) offenders.set(rule.id, []);
        offenders.get(rule.id).push(rel + ':' + (i + 1) + '  ' + row.trim().slice(0, 110));
      }
    }
  }

  let total = 0;
  for (const rule of DESKTOP_RULES) {
    const rows = offenders.get(rule.id) ?? [];
    total += rows.length;
    if (rows.length === 0) continue;
    console.log('  ✗ desktop ' + rule.id + '（' + rows.length + ' 处）：' + rule.hint);
    for (const row of rows.slice(0, 8)) console.log('      ' + row);
    if (rows.length > 8) console.log('      …其余 ' + (rows.length - 8) + ' 处');
  }
  if (total > 0) {
    console.log('✗ design-lint desktop 严格模式未通过：共 ' + total + ' 处');
    failed = true;
  } else {
    console.log('✓ design-lint desktop 严格模式通过');
  }
}

scanDesktopStrict();

if (failed) {
  console.log('✗ design-lint 未通过：存在非 token 颜色/不透明度写法');
  process.exit(1);
}
console.log('✓ design-lint passed');
