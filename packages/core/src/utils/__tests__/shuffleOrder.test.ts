import { describe, expect, it } from 'vitest';
import {
  applyShuffleOrder,
  createShuffleState,
  insertNextInShuffle,
  normalizeShuffleOrder,
  replaceShuffleSongId,
  stepShuffle,
  syncShuffleCursor,
  type ShuffleState,
} from '../shuffleOrder.js';
import type { Song } from '../../types/index.js';

function song(id: string): Song {
  return { id, name: id, artist: 'a', album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

const queue = [song('a'), song('b'), song('c'), song('d')];
const ids = (songs: readonly Song[]) => songs.map((s) => s.id);
const zero = () => 0;

describe('createShuffleState（Fisher–Yates，rng 可注入）', () => {
  it('rng 全 0 时的确定性顺序', () => {
    // i=3,j=0 → [d,b,c,a]；i=2,j=0 → [c,b,d,a]；i=1,j=0 → [b,c,d,a]
    expect(createShuffleState(queue, { rng: zero }).order).toEqual(['b', 'c', 'd', 'a']);
  });

  it('结果是队列 id 的一个排列（不重不漏）', () => {
    const { order } = createShuffleState(queue);
    expect([...order].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('currentIndex 合法时游标落在当前曲上', () => {
    const state = createShuffleState(queue, { rng: zero, currentIndex: 1 }); // 当前 = b
    expect(state.order[state.cursor]).toBe('b');
  });

  it('currentIndex 非法 / 缺省 → 游标 -1（尚无当前曲）', () => {
    expect(createShuffleState(queue, { rng: zero }).cursor).toBe(-1);
    expect(createShuffleState(queue, { rng: zero, currentIndex: 9 }).cursor).toBe(-1);
    expect(createShuffleState(queue, { rng: zero, currentIndex: -1 }).cursor).toBe(-1);
  });

  it('空队列 → 空序列、游标 -1', () => {
    expect(createShuffleState([], { rng: zero })).toEqual({ order: [], cursor: -1 });
  });
});

describe('stepShuffle（游标前进 / 后退 + 回绕）', () => {
  const state: ShuffleState = { order: ['b', 'c', 'd', 'a'], cursor: 0 };

  it('next 前进一格（映射回队列下标）', () => {
    const step = stepShuffle(state, queue, 1);
    expect(step.index).toBe(2); // c
    expect(step.state.cursor).toBe(1);
  });

  it('prev 后退一格——回到序列里的上一张（#511 回归点）', () => {
    const onC: ShuffleState = { order: ['a', 'b', 'c'], cursor: 1 };
    const back = stepShuffle(onC, [song('a'), song('b'), song('c')], -1);
    expect(back.index).toBe(0); // a，正是上一张
    expect(back.state.cursor).toBe(0);
  });

  it('两端回绕', () => {
    expect(stepShuffle({ order: ['a', 'b', 'c'], cursor: 2 }, [song('a'), song('b'), song('c')], 1).index).toBe(0);
    expect(stepShuffle({ order: ['a', 'b', 'c'], cursor: 0 }, [song('a'), song('b'), song('c')], -1).index).toBe(2);
  });

  it('游标 -1（尚无当前曲）：next 从序列开头、prev 从末尾', () => {
    expect(stepShuffle({ order: ['c', 'a', 'b'], cursor: -1 }, [song('a'), song('b'), song('c')], 1).index).toBe(2); // c
    expect(stepShuffle({ order: ['c', 'a', 'b'], cursor: -1 }, [song('a'), song('b'), song('c')], -1).index).toBe(1); // b
  });

  it('游标越界（持久化损坏）按 -1 处理，不抛', () => {
    expect(stepShuffle({ order: ['a', 'b', 'c'], cursor: 99 }, [song('a'), song('b'), song('c')], 1).index).toBe(0);
    expect(stepShuffle({ order: ['a', 'b', 'c'], cursor: 99 }, [song('a'), song('b'), song('c')], -1).index).toBe(2);
  });

  it('单元素队列：两个方向都归位该曲', () => {
    const only = [song('a')];
    expect(stepShuffle({ order: ['a'], cursor: 0 }, only, 1).index).toBe(0);
    expect(stepShuffle({ order: ['a'], cursor: 0 }, only, -1).index).toBe(0);
  });

  it('空队列 → index -1', () => {
    expect(stepShuffle({ order: [], cursor: -1 }, [], 1)).toEqual({ index: -1, state: { order: [], cursor: -1 } });
  });

  it('不修改入参', () => {
    const input: ShuffleState = { order: ['a', 'b'], cursor: 0 };
    stepShuffle(input, [song('a'), song('b')], 1);
    expect(input).toEqual({ order: ['a', 'b'], cursor: 0 });
  });

  it('队列成员变化时增量对齐：游标所指的歌还在 → 游标跟随它', () => {
    // 删掉的是 c（游标指向 a）→ 序列变 [a,b]，游标仍是 a，next 落到 b
    const shrunk = stepShuffle({ order: ['a', 'b', 'c'], cursor: 0 }, [song('a'), song('b')], 1);
    expect(shrunk.state.order).toEqual(['a', 'b']);
    expect(shrunk.index).toBe(1);
  });

  it('游标所指的歌被删掉 → 游标归 -1，next 从序列开头起（不抛）', () => {
    const shrunk = stepShuffle({ order: ['a', 'b', 'c'], cursor: 1 }, [song('a'), song('c')], 1);
    expect(shrunk.state.order).toEqual(['a', 'c']);
    expect(shrunk.index).toBe(0);
  });
});

describe('syncShuffleCursor / normalizeShuffleOrder', () => {
  it('成员对齐：丢掉不在队列的、新歌追加到末尾（不重洗）', () => {
    const n = normalizeShuffleOrder({ order: ['c', 'a', 'b'], cursor: 0 }, [song('b'), song('a'), song('d')]);
    expect(n.order).toEqual(['a', 'b', 'd']);
  });

  it('游标对到当前曲在序列中的位置', () => {
    const s = syncShuffleCursor({ order: ['c', 'a', 'b'], cursor: 0 }, [song('a'), song('b'), song('c')], 1); // b
    expect(s.order[s.cursor]).toBe('b');
  });

  it('无当前曲 → 游标 -1', () => {
    expect(syncShuffleCursor({ order: ['a', 'b'], cursor: 0 }, [song('a'), song('b')], -1).cursor).toBe(-1);
  });

  it('重复 id 防御：只保留一次', () => {
    const n = normalizeShuffleOrder({ order: ['a', 'a', 'b'], cursor: 0 }, [song('a'), song('b')]);
    expect(n.order).toEqual(['a', 'b']);
  });
});

describe('insertNextInShuffle（随机序里的「下一首播放」）', () => {
  const q = () => [song('a'), song('b'), song('c'), song('d')];

  it('已在序列且不在目标位 → 移动到当前曲下一格（不复制、长度不变）', () => {
    const next = insertNextInShuffle({ order: ['a', 'b', 'c', 'd'], cursor: 1 }, q(), 'd', 1);
    expect(next.order).toEqual(['a', 'b', 'd', 'c']);
    expect(next.cursor).toBe(1);
  });

  it('幂等：已在当前曲下一格 → 原样返回', () => {
    const before: ShuffleState = { order: ['a', 'b', 'c', 'd'], cursor: 1 };
    const after = insertNextInShuffle(before, q(), 'c', 1);
    expect(after).toEqual(before);
  });

  it('点的是当前曲本身 → 原样返回', () => {
    const before: ShuffleState = { order: ['a', 'b', 'c', 'd'], cursor: 1 };
    expect(insertNextInShuffle(before, q(), 'b', 1)).toEqual(before);
  });

  it('源在当前曲之前 → 摘除后锚点左移，仍插到当前曲正后方', () => {
    const next = insertNextInShuffle({ order: ['a', 'b', 'c', 'd'], cursor: 2 }, q(), 'a', 2); // 当前 = c
    expect(next.order).toEqual(['b', 'c', 'a', 'd']);
    expect(next.order[next.cursor]).toBe('c');
    expect(next.cursor).toBe(1);
  });

  it('不在序列（新加入队列、已补在末尾）→ 插入到当前曲下一格', () => {
    const withNew = [...q(), song('x')];
    const next = insertNextInShuffle({ order: ['a', 'b', 'c', 'd', 'x'], cursor: 1 }, withNew, 'x', 1);
    expect(next.order).toEqual(['a', 'b', 'x', 'c', 'd']);
    expect(next.order[next.cursor]).toBe('b');
  });

  it('无当前曲 → 插到序列开头（下一首就是它）', () => {
    const next = insertNextInShuffle({ order: ['a', 'b', 'c'], cursor: -1 }, [song('a'), song('b'), song('c')], 'c', -1);
    expect(next.order).toEqual(['c', 'a', 'b']);
  });
});

describe('replaceShuffleSongId（队列原位换源）', () => {
  it('同格替换，游标位置不变', () => {
    expect(replaceShuffleSongId({ order: ['a', 'b', 'c'], cursor: 1 }, 'b', 'x')).toEqual({
      order: ['a', 'x', 'c'],
      cursor: 1,
    });
  });

  it('不在序列里 → 原样返回', () => {
    const before: ShuffleState = { order: ['a', 'b'], cursor: 0 };
    expect(replaceShuffleSongId(before, 'z', 'x')).toEqual(before);
  });
});

describe('applyShuffleOrder（按随机序重排，供队列页/移动端取窗）', () => {
  it('按序列重排，序列外的歌按原顺序补末尾（等长）', () => {
    const out = applyShuffleOrder([song('a'), song('b'), song('c')], { order: ['c', 'a'], cursor: 0 });
    expect(ids(out)).toEqual(['c', 'a', 'b']);
    expect(out).toHaveLength(3);
  });

  it('null / 空序列 → 原队列副本', () => {
    const src = [song('a'), song('b')];
    expect(ids(applyShuffleOrder(src, null))).toEqual(['a', 'b']);
    expect(applyShuffleOrder(src, null)).not.toBe(src);
  });
});
