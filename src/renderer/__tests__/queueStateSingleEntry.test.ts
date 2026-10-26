import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #639 C1 守卫：队列状态转移只有一个入口（`planQueueState`），落盘只有一个出口（playerStore 订阅）。
 * 结构断言，判据只看剥掉注释后的源码——免得下一个 action 又把旁路开回来。
 */

const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 本文件在 <root>/src/renderer/__tests__/ 下，基准取 <root>/src/renderer */
const read = (rel: string) =>
  readFileSync(join(testDir, '..', rel), 'utf8')
    // 仓库 checkout 是 CRLF（core.autocrlf=true），先归一，否则按行切块的正则全部落空
    .replace(/\r\n/g, '\n');

const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * action 实现所在的区间：`create<PlayerStore>((set, get) => ({` 之后。
 * 接口声明里也有同名签名（`reorderShuffle: (...) => void;`），从文件头找会命中声明而不是实现。
 */
function implementationSection(source: string): string {
  const at = source.indexOf('create<PlayerStore>(');
  expect(at, '源码里找不到 create<PlayerStore>( 的 store 实现').toBeGreaterThanOrEqual(0);
  return source.slice(at);
}

/** 按大括号配对切出一个 action 的方法体（签名定位，不依赖缩进）。 */
function actionBody(source: string, signature: string): string {
  const start = implementationSection(source).indexOf(signature);
  expect(start, `源码里找不到 ${signature} 的实现`).toBeGreaterThanOrEqual(0);
  source = implementationSection(source);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`无法切出 ${signature} 的方法体`);
}

describe('#639 C1：队列状态转移的唯一入口与唯一出口', () => {
  it('persistQueue 的手写调用点只有 store 订阅那一处（单一出口）', () => {
    const source = codeOnly(read('store/playerStore.ts'));
    expect((source.match(/persistQueue\(/g) ?? []).length).toBe(1);
    // 且它在订阅回调里：位置在 lastPersisted 声明之后（不是任何 action 内）
    const anchor = source.indexOf('let lastPersisted');
    expect(anchor).toBeGreaterThan(0);
    expect(source.indexOf('persistQueue(')).toBeGreaterThan(anchor);
  });

  it('三个曾经绕过 planner 的 action 都改走变体', () => {
    const source = codeOnly(read('store/playerStore.ts'));

    // reorderShuffle：序列类变体（新顺序交给 planner，游标不在这里算）
    const reorderShuffle = actionBody(source, 'reorderShuffle: (');
    expect(reorderShuffle).toContain("policy: 'reorder-shuffle'");
    expect(reorderShuffle).not.toMatch(/cursor:\s/); // 游标归 planner 推导

    // insertNext 的空队列分支：与「新建队列」同一条路（reseed），不再自己算 shuffle
    //（随机分支里的 syncShuffle 是「喂给 insertNextInShuffle 的权威序列」，它本身也走 planner，不算旁路）
    const insertNext = actionBody(source, 'insertNext: async');
    const emptyQueueBranch = insertNext.slice(
      insertNext.indexOf('currentPlaylist.length === 0'),
      insertNext.indexOf('currentPlaylistIndex === -1'),
    );
    expect(emptyQueueBranch).not.toBe('');
    expect(emptyQueueBranch).toContain("policy: 'reseed'");
    expect(emptyQueueBranch).not.toMatch(/syncShuffle\(/);
  });

  it('stop() 与 clearQueue 语义分开：前者保留队列，后者才是终止态', () => {
    const source = codeOnly(read('store/playerStore.ts'));

    const stopAction = actionBody(source, 'stop: () =>');
    expect(stopAction).toContain("policy: 'align'"); // 停播只归零落点，不动成员
    expect(stopAction).not.toContain("policy: 'stop'");

    const clearAction = actionBody(source, 'clearQueue: () =>');
    expect(clearAction).toContain("policy: 'stop'");
  });

  it('planQueueState 的变体集合覆盖票面六类（成员/落点/序列/模式/终止）', () => {
    const source = codeOnly(read('store/queueState.ts'));
    for (const policy of [
      'align', 'locate', 'settle', 'reseed', 'replace-id', 'mode', 'reorder-shuffle', 'stop',
    ]) {
      expect(source, `缺变体 ${policy}`).toContain(`case '${policy}'`);
    }
  });
});
