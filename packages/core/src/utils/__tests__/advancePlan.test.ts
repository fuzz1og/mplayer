import { describe, it, expect } from 'vitest';
import type { Song } from '../../types/index.js';
import { planAdvance, type AdvanceInput } from '../queue.js';

const song = (id: string): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: 'netease',
});

const queue = [song('1'), song('2'), song('3')];

/** 造一个完整的 AdvanceInput，缺省是「列表循环 / 下一首 / 用户点按 / 无序列」。 */
function input(overrides: Partial<AdvanceInput> = {}): AdvanceInput {
  return {
    queue,
    currentIndex: 0,
    playMode: '列表循环',
    shuffle: null,
    direction: 1,
    cause: 'user',
    ...overrides,
  };
}

/**
 * #541：推进落点的唯一事实来源。
 * 此前「推进到哪」在 core 而「怎么落」散在三个宿主，且单曲循环的 prev 在移动端
 * 与桌面不一致（core 注释长期断言「与桌面一致」）。这里用矩阵把契约钉死。
 */
describe('planAdvance（#541 推进落点唯一来源）', () => {
  it('队列空 / 下标越界 → none', () => {
    expect(planAdvance(input({ queue: [] }))).toMatchObject({ index: -1, effect: 'none' });
    expect(planAdvance(input({ currentIndex: -1 }))).toMatchObject({ index: -1, effect: 'none' });
    expect(planAdvance(input({ currentIndex: 9 }))).toMatchObject({ index: -1, effect: 'none' });
  });

  it('列表循环：前进/后退并回绕 → load-target', () => {
    expect(planAdvance(input({ currentIndex: 0, direction: 1 }))).toMatchObject({ index: 1, effect: 'load-target' });
    expect(planAdvance(input({ currentIndex: 2, direction: 1 }))).toMatchObject({ index: 0, effect: 'load-target' });
    expect(planAdvance(input({ currentIndex: 0, direction: -1 }))).toMatchObject({ index: 2, effect: 'load-target' });
  });

  it('单元素队列：两个方向都归位当前曲 → restart-current', () => {
    const one = [song('1')];
    expect(planAdvance(input({ queue: one, direction: 1 }))).toMatchObject({ index: 0, effect: 'restart-current' });
    expect(planAdvance(input({ queue: one, direction: -1 }))).toMatchObject({ index: 0, effect: 'restart-current' });
  });

  it('单曲循环 + 下一首 = 重播当前曲（restart-current，不重新解析）', () => {
    expect(planAdvance(input({ currentIndex: 1, playMode: '单曲循环', direction: 1 }))).toMatchObject({
      index: 1,
      effect: 'restart-current',
    });
  });

  it('单曲循环 + 上一首 = 回上一首（load-target，不重播）——两端同此的可执行契约', () => {
    // 这条此前只活在注释里：移动端实际是重播当前曲，桌面是回上一首。
    expect(planAdvance(input({ currentIndex: 1, playMode: '单曲循环', direction: -1 }))).toMatchObject({
      index: 0,
      effect: 'load-target',
    });
    // 回绕：第 0 首的上一首 = 末首
    expect(planAdvance(input({ currentIndex: 0, playMode: '单曲循环', direction: -1 }))).toMatchObject({
      index: 2,
      effect: 'load-target',
    });
  });

  it('随机播放 + 有序列：沿序列推进并返回推进后的序列', () => {
    // 序列 = ['3','1','2']，当前曲是 queue[0] = '1' → 游标对齐到 1
    const shuffle = { order: ['3', '1', '2'], cursor: 1 };
    const plan = planAdvance(input({ playMode: '随机播放', shuffle, direction: 1 }));
    expect(plan.index).toBe(1); // 序列下一格 = '2' → 成员下标 1
    expect(plan.effect).toBe('load-target');
    expect(plan.shuffle?.cursor).toBe(2);
  });

  it('随机播放 + 有序列：后退一格回到序列上一张', () => {
    const shuffle = { order: ['3', '1', '2'], cursor: 1 };
    const plan = planAdvance(input({ playMode: '随机播放', shuffle, direction: -1 }));
    expect(plan.index).toBe(2); // 序列上一格 = '3' → 成员下标 2
    expect(plan.shuffle?.cursor).toBe(0);
  });

  it('随机播放 + 显式 null：走兼容路径（防重复现抽），不抛错', () => {
    const plan = planAdvance(input({ playMode: '随机播放', shuffle: null, currentIndex: 1, direction: 1 }));
    expect(plan.index).toBeGreaterThanOrEqual(0);
    expect(plan.index).not.toBe(1); // 防重复：不会抽到当前曲自己（队列 > 1）
    expect(plan.shuffle).toBeNull();
  });

  it('非随机模式下序列原样返回（不被推进逻辑改动）', () => {
    const shuffle = { order: ['1', '2', '3'], cursor: 0 };
    expect(planAdvance(input({ playMode: '列表循环', shuffle })).shuffle).toBe(shuffle);
    expect(planAdvance(input({ playMode: '单曲循环', shuffle, direction: -1 })).shuffle).toBe(shuffle);
  });

  it('cause 不改变推进结果（只用于宿主侧语义区分）', () => {
    for (const cause of ['user', 'track-end', 'failure'] as const) {
      expect(planAdvance(input({ cause, direction: 1 }))).toMatchObject({ index: 1 });
    }
  });
});
