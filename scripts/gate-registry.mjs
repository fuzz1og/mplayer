#!/usr/bin/env node
/**
 * gate-registry.mjs — 门禁必须被某个入口调用（#717）：脚本躺在仓库里没人跑就是假门禁。
 * #654 注释门禁、#557 core typecheck 都犯过；判据是「门禁形态的脚本 / npm 命令出现在 verify.mjs、pre-commit 或某个 workflow 里」。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 门禁形态：名字带 gate/lint/guard 的脚本。其余脚本（发布、真机、迁移）按用途命名，不在此列。 */
const GATE_SHAPE = /(gate|lint|guard)\.(mjs|js)$/;
/** 只在人工流程里出现的门禁形态脚本：必须写明为什么它不该进 verify。当前为空（恒定的常态）。 */
const MANUAL = new Map();

const ENTRY_FILES = ['scripts/verify.mjs', '.githooks/pre-commit'];
const WORKFLOW_DIR = '.github/workflows';

const read = (rel) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), 'utf8') : null);

/** 入口正文：verify + pre-commit + 全部 workflow。命中的意思是「这个入口会调用它」。 */
function entryTexts() {
  const texts = [];
  for (const rel of ENTRY_FILES) {
    const text = read(rel);
    if (text === null) console.error('⚠ 缺少入口文件 ' + rel + '（门禁配置过期？）');
    else texts.push({ rel, text });
  }
  const dir = path.join(ROOT, WORKFLOW_DIR);
  if (!existsSync(dir)) console.error('⚠ 缺少 ' + WORKFLOW_DIR);
  else for (const name of readdirSync(dir).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))) {
    texts.push({ rel: WORKFLOW_DIR + '/' + name, text: read(WORKFLOW_DIR + '/' + name) ?? '' });
  }
  return texts;
}

const entries = entryTexts();
const referencedBy = (needle) => entries.filter(({ text }) => text.includes(needle)).map(({ rel }) => rel);
const violations = [];

// 1) 门禁形态的脚本
const scriptFiles = readdirSync(path.join(ROOT, 'scripts')).filter((file) => GATE_SHAPE.test(file));
const registeredGateScripts = new Set(scriptFiles.filter((file) => !MANUAL.has(file) && referencedBy(file).length > 0));
for (const file of scriptFiles) {
  const manual = MANUAL.get(file);
  const refs = referencedBy(file);
  if (manual) {
    if (refs.length === 0) violations.push('scripts/' + file + ' 登记为人工脚本（' + manual + '），但没有任何入口提到它'); // dead allowlist
    continue;
  }
  if (refs.length === 0) violations.push('scripts/' + file + ' 未被任何入口调用（verify.mjs / pre-commit / workflow）');
}
for (const [file] of MANUAL) {
  if (!existsSync(path.join(ROOT, 'scripts', file))) violations.push('scripts/' + file + ' 已删除，从 MANUAL 允许清单移除');
}

// 2) 门禁形态的 npm 命令（名字带 check/gate/lint/guard）
const pkg = JSON.parse(read('package.json') ?? '{}');
const scripts = pkg.scripts ?? {};
for (const [name, command] of Object.entries(scripts)) {
  if (!/(check|gate|lint|guard)/i.test(name)) continue;
  if (referencedBy('npm run ' + name).length > 0) continue;
  // 包装门禁脚本的命令（如 design-lint → design-lint.mjs）：被包的那个脚本本身已登记，才算有入口。
  const wrapped = /(scripts\/[\w.-]+\.(?:mjs|js))/.exec(command ?? '');
  if (wrapped && registeredGateScripts.has(path.basename(wrapped[1]))) continue;
  violations.push('npm run ' + name + '（' + command + '）未被任何入口调用');
}

if (violations.length > 0) {
  console.error('✗ 门禁登记未过（' + violations.length + ' 条）：\n');
  for (const v of violations) console.error('  ' + v);
  console.error([
    '',
    '  处置：接进 scripts/verify.mjs 的某个分片（唯一入口），或进 .githooks/pre-commit / workflow；',
    '        确实只应人工跑的，登记到本脚本的 MANUAL 并写明理由。',
  ].join('\n'));
  process.exit(1);
}
console.log('✓ 门禁登记：' + scriptFiles.length + ' 个门禁脚本 + ' +
  Object.keys(scripts).filter((n) => /(check|gate|lint|guard)/i.test(n)).length + ' 个门禁命令，全部有入口');
