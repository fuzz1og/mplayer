import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import {
  beginResolve,
  endResolve,
  isCoolingDown,
  isFresh,
  isInFlight,
  markFailed,
  markSucceeded,
  planNextIndexes,
  prefetchKey,
  resetPrefetchState,
} from '../services/queuePrefetch';

function song(id: string, name = `song-${id}`): Song {
  return { id, name, artist: 'artist' } as Song;
}

const queue = [song('1'), song('2'), song('3'), song('4'), song('5')];

beforeEach(() => {
  resetPrefetchState();
});

describe('预取三层去重（规格 §5.5，沿用 PR #433 的参数）', () => {
  it('在飞去重：同一 key 不并发解析', () => {
    const key = prefetchKey(queue[0]);
    expect(beginResolve(key)).toBe(true);
    expect(isInFlight(key)).toBe(true);
    // 第二次进入同一首必须被拒（否则同一条 tier3 链会被烧两遍）
    expect(beginResolve(key)).toBe(false);
    endResolve(key);
    expect(isInFlight(key)).toBe(false);
    expect(beginResolve(key)).toBe(true);
  });

  it('成功窗口：5min 内不重复解析，超窗后可再解析', () => {
    const key = prefetchKey(queue[1]);
    markSucceeded(key, 1_000_000);
    expect(isFresh(key, 1_000_000 + 4 * 60 * 1000)).toBe(true);
    expect(isFresh(key, 1_000_000 + 6 * 60 * 1000)).toBe(false);
  });

  it('失败冷却：30s 内不再重烧整条解析链', () => {
    const key = prefetchKey(queue[2]);
    markFailed(key, 1_000_000);
    expect(isCoolingDown(key, 1_000_000 + 29 * 1000)).toBe(true);
    expect(isCoolingDown(key, 1_000_000 + 31 * 1000)).toBe(false);
  });

  it('成功会清掉失败冷却（换到新 URL 后不该继续背着旧冷却）', () => {
    const key = prefetchKey(queue[3]);
    markFailed(key, 1_000_000);
    markSucceeded(key, 1_000_001);
    expect(isCoolingDown(key, 1_000_002)).toBe(false);
    expect(isFresh(key, 1_000_002)).toBe(true);
  });
});

describe('窗口定序 planNextIndexes（§5.5 / §7.3）', () => {
  it('顺序模式：从当前 index 之后连续取 count 个', () => {
    expect(planNextIndexes(queue, 1, 3, new Set(), '列表循环')).toEqual([2, 3, 4]);
  });

  it('越过队列尾部即停（不绕回，绕回由 core/播放模式决定）', () => {
    expect(planNextIndexes(queue, 3, 3, new Set(), '列表循环')).toEqual([4]);
  });

  it('已在原生手里的 key 不重复投喂', () => {
    const excluded = new Set([prefetchKey(queue[2])]);
    expect(planNextIndexes(queue, 0, 3, excluded, '列表循环')).toEqual([1, 3, 4]);
  });

  it('随机模式：下一首 != 当前曲，窗口内互不重复，且相邻不重复', () => {
    // 多次抽样。core 的随机语义是「每次随机且 ≠ 当前」（queue.ts，无记忆）——
    // 所以「窗口里再出现当前曲」是合法结果，「紧接着又播同一首」不是。
    for (let round = 0; round < 80; round += 1) {
      const planned = planNextIndexes(queue, 0, 3, new Set(), '随机播放');
      expect(planned.length).toBeGreaterThan(0);
      expect(planned[0]).not.toBe(0);
      expect(new Set(planned).size).toBe(planned.length);
      for (let i = 1; i < planned.length; i += 1) {
        expect(planned[i]).not.toBe(planned[i - 1]);
      }
      planned.forEach((index) => {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(queue.length);
      });
    }
  });

  it('随机模式在队列只剩当前一首时取不到候选 → 返回空（原生按窗口耗尽处理）', () => {
    expect(planNextIndexes([song('only')], 0, 3, new Set(), '随机播放')).toEqual([]);
  });

  it('count<=0 或空队列直接返回空', () => {
    expect(planNextIndexes(queue, 0, 0, new Set(), '列表循环')).toEqual([]);
    expect(planNextIndexes([], 0, 3, new Set(), '列表循环')).toEqual([]);
  });
});
