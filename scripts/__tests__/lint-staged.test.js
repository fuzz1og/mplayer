/**
 * 回归对象：lint-staged 的分批必须同时受「文件数」与「字符数」双闸门约束（#654）。
 * 单批超限就是当初 xargs 撞命令行长度上限的成因，故这里盯的是分批边界而非 eslint 本身。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(
  path.resolve(__dirname, '..', 'lint-staged.mjs')
).href;

test('空清单不产生批次（不 spawn 空调用）', async () => {
  const { planInvocations } = await import(MODULE);
  assert.deepEqual(planInvocations([]), []);
});

test('文件数闸门：超过 maxFiles 即切批，且不丢文件', async () => {
  const { planInvocations } = await import(MODULE);
  const files = Array.from({ length: 95 }, (_, i) => `src/f${i}.ts`);
  const batches = planInvocations(files, 40, 1e9);
  assert.deepEqual(batches.map((b) => b.length), [40, 40, 15]);
  assert.deepEqual(batches.flat(), files);
});

test('字符数闸门：单批字符数不超上限，且不丢文件', async () => {
  const { planInvocations } = await import(MODULE);
  const files = Array.from({ length: 60 }, (_, i) => `src/${'d'.repeat(50)}/f${i}.ts`);
  const batches = planInvocations(files, 1e9, 300);
  for (const batch of batches) {
    const chars = batch.reduce((n, f) => n + f.length + 1, 0);
    assert.ok(chars <= 300, `批字符数 ${chars} 超上限`);
  }
  assert.deepEqual(batches.flat(), files);
});

test('单个文件超字符上限时仍独占一批（不死循环、不丢文件）', async () => {
  const { planInvocations } = await import(MODULE);
  const huge = `src/${'x'.repeat(500)}.ts`;
  const batches = planInvocations([huge, 'src/small.ts'], 40, 100);
  assert.deepEqual(batches, [[huge], ['src/small.ts']]);
});
