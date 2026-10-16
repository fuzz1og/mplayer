#!/usr/bin/env node
/**
 * comment-gate.mjs — 注释块的内容行不得超过 3 行（#651）。
 * 代码注释只留**必须留在代码里的**：非显然的约束、陷阱、契约。
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

const SCAN_ROOTS = ['src', 'packages', 'scripts', 'e2e', 'resources', 'public', 'examples'];
const SCAN_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.kt', '.java'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '.git', '.expo', 'build', '.gradle']);

/** 每块的**内容行**上限。超过即 fail。 */
const MAX_CONTENT_LINES = 3;

/** 纯标记/指令行：整块全是这类行时豁免（它们必须留在代码里，且长度由工具决定）。 */
const MARKER_LINE = /^(TODO|FIXME|HACK|XXX|NOTE|@ts-(expect-error|ignore|nocheck|check)|eslint-(disable|enable)|@vitest-environment|@jest-environment|prettier-ignore|@prettier|Copyright|SPDX-License-Identifier|@generated|@nolint)\b/i;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(abs);
    } else if (SCAN_EXT.some((x) => entry.name.endsWith(x))) {
      yield abs;
    }
  }
}

/** 去掉注释前缀后的内容（含 JSX 花括号包裹的块注释）；空行返回 ''（不计入内容行）。 */
const stripComment = (t) =>
  t
    .replace(/^\{\s*/, '')
    .replace(/\*+\}\s*$/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\/\*+/, '')
    .replace(/^\/\/+/, '')
    .replace(/^\*+/, '')
    .replace(/\*+$/, '')
    .trim();

const violations = [];
let blocks = 0;

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = toRel(file);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    let cur = [];
    const flush = () => {
      if (cur.length === 0) return;
      blocks++;
      const content = cur.map((b) => b.content).filter(Boolean);
      if (content.length > MAX_CONTENT_LINES && !content.every((c) => MARKER_LINE.test(c))) {
        violations.push({ rel, line: cur[0].line, n: content.length });
      }
      cur = [];
    };
    lines.forEach((raw, i) => {
      const t = raw.trim();
      const isComment = t.startsWith('//') || t.startsWith('/*') || t.startsWith('{/*') || t.startsWith('*') || t === '*/' || t === '*/}';
      if (isComment) {
        cur.push({ line: i + 1, content: stripComment(t) });
        // A block comment ends at its closer: flush so two adjacent blocks stay separate.
        if (t.endsWith('*/') || t.endsWith('*/}')) flush();
      } else flush();
    });
    flush();
  }
}

if (violations.length > 0) {
  console.error('✗ 注释门禁未过（' + violations.length + ' 块超过 ' + MAX_CONTENT_LINES + ' 行）：\n');
  for (const v of violations) console.error('  ' + v.rel + ':' + v.line + '  ' + v.n + ' 行内容');
  console.error([
    '',
    '  处置：注释只留必须留在代码里的（非显然约束 / 陷阱 / 契约），压到 ≤' + MAX_CONTENT_LINES + ' 行；',
    '        叙述与理由进 ADR / issue，代码里最多留一行指针（见 CODING_STANDARDS.md）。',
  ].join('\n'));
  process.exit(1);
}
console.log('✓ 注释门禁：' + blocks + ' 个注释块，无超过 ' + MAX_CONTENT_LINES + ' 行的块');
