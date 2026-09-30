#!/usr/bin/env node
/**
 * design-lint.mjs — 组件内颜色/不透明度门禁（UI 重构指南 §9 + #318 审计）。
 *
 * 移植自 `scripts/design-lint.sh`（#500：Windows 上 `bash` 可能是 WSL 的，脚本不再依赖 bash）。
 * 扫描语义、输出与退出码与前者对齐；`scripts/design-lint.sh` 只剩两行 shim。
 *
 * 扫描：
 *   1) mobile 严格模式：packages/mobile/{components,app} 内四类写法一律 fail ——
 *      a. 引号包裹的 hex 色值
 *      b. rgb()/rgba() 字面量（含数字，`rgb(0,0,0)` 这类）
 *      c. 命名色（white/black/red/...；'transparent' 不在此列，它是无语义替代）
 *      d. 裸 opacity 魔数（`opacity: 0.x`）—— 改用 theme/tokens.ts 的 `opacity.*`；
 *      合法遗留在该行行尾注释 `design-lint: ok`（附原因），例如 MaskedView 的 alpha 蒙版。
 *   2) desktop 黑名单模式：src/renderer 内命中遗留 hex 黑名单（LEGACY_HEX）即 fail。
 *      桌面 P2（清账 187 hex，延后）逐项清理后把对应色值填进黑名单防回归，
 *      因此当前为空清单、恒通过——门禁随 P2 进度生效。
 * 注：正则限定引号包裹，避免误伤注释里的 GitHub issue 引用（#172/#173 等）。
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

if (failed) {
  console.log('✗ design-lint 未通过：存在非 token 颜色/不透明度写法');
  process.exit(1);
}
console.log('✓ design-lint passed');
