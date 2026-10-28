#!/usr/bin/env node
/**
 * page-coverage.mjs — 新增页面必须带测试（#717）：路由里每个懒加载页面都要在 src/renderer/__tests__/ 有引用。
 * 允许清单登记不该有测试的页面并写明理由（当前只有开发用的原语陈列页）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = 'src/renderer/router/index.tsx';
const TEST_DIR = 'src/renderer/__tests__';
/** 页面名 → 为什么不要求测试。没有正当理由的条目应直接补测试。 */
const ALLOW = new Map([
  ['UiLabPage', '开发用的原语陈列页：不在产品导航里，验收方式是页面本身目视'],
]);

const routerPath = path.join(ROOT, ROUTER);
if (!existsSync(routerPath)) {
  console.error('✗ 路由文件不存在：' + ROUTER + '（门禁配置过期）');
  process.exit(1);
}

/** 懒加载页面：写成 lazy(() => import('@/renderer/pages/Xxx'))，每条对应一个页面 chunk。 */
const LAZY_PAGE = /lazy\(\s*\(\)\s*=>\s*import\('([^']+)'\)/g;
const pages = [...readFileSync(routerPath, 'utf8').matchAll(LAZY_PAGE)].map((m) => m[1]);
if (pages.length === 0) {
  console.error('✗ 在 ' + ROUTER + ' 里解析不到懒加载页面——路由写法变了？先修本门禁再提交。');
  process.exit(1);
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield abs;
  }
}

let testBlob = '';
for (const file of walk(path.join(ROOT, TEST_DIR))) testBlob += readFileSync(file, 'utf8') + '\n';
if (testBlob === '') {
  console.error('✗ ' + TEST_DIR + ' 下读不到任何测试文件');
  process.exit(1);
}

const uncovered = [];
for (const specifier of pages) {
  const page = path.posix.basename(specifier);
  const covered = testBlob.includes(page) || testBlob.includes(specifier);
  const reason = ALLOW.get(page);
  if (covered && reason) {
    uncovered.push(page + ' 已有测试引用，把它从 ALLOW 移除');
    continue;
  }
  if (!covered && !reason) uncovered.push(page + '（' + specifier + '）没有测试引用');
  const file = path.join(ROOT, 'src', 'renderer', 'pages', page + '.tsx');
  if (!existsSync(file)) uncovered.push(page + ' 在路由里被引用，但 src/renderer/pages/' + page + '.tsx 不存在');
}
for (const [page] of ALLOW) {
  if (!pages.some((specifier) => path.posix.basename(specifier) === page)) {
    uncovered.push(page + ' 已不在路由里，把它从 ALLOW 移除');
  }
}

if (uncovered.length > 0) {
  console.error('✗ 页面测试覆盖未过（' + uncovered.length + ' 条）：\n');
  for (const v of uncovered) console.error('  ' + v);
  console.error([
    '',
    '  处置：在 ' + TEST_DIR + '/ 里加一个渲染该页面的测试（jsdom 足够，交互断言见 ',
    '        songListModule.test.tsx 的写法）；确实不该有测试的页面登记到本脚本 ALLOW 并写明理由。',
  ].join('\n'));
  process.exit(1);
}
console.log('✓ 页面测试覆盖：' + pages.length + ' 个懒加载页面，' +
  (pages.length - ALLOW.size) + ' 个有测试引用，' + ALLOW.size + ' 个在 ALLOW 里登记了理由');
