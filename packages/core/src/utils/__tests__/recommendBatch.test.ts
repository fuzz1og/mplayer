import { describe, expect, it } from 'vitest';
import { pickRandomBatch } from '../recommendBatch.js';

const POOL = Array.from({ length: 100 }, (_, i) => ({ id: `song-${i}` }));

describe('pickRandomBatch（推荐池随机抽 5 首）', () => {
  it('从 100 首池中抽出 5 首且不重复', () => {
    const { batch, used } = pickRandomBatch(POOL, [], 5);
    expect(batch).toHaveLength(5);
    expect(new Set(batch.map((s) => s.id)).size).toBe(5);
    expect(used).toHaveLength(5);
  });

  it('连续抽批一轮内不重复（不放回）', () => {
    let used: number[] = [];
    const seen = new Set<string>();
    for (let round = 0; round < 4; round++) {
      const { batch, used: nextUsed } = pickRandomBatch(POOL, used, 5);
      for (const s of batch) {
        expect(seen.has(s.id)).toBe(false);
        seen.add(s.id);
      }
      used = nextUsed;
    }
    expect(seen.size).toBe(20);
  });

  it('一轮抽完后自动重置,继续能抽出 5 首', () => {
    // 模拟已抽完 96 首:剩余不足 5 首 → 重置后从全池重新随机
    const used = Array.from({ length: 96 }, (_, i) => i);
    const { batch, used: nextUsed } = pickRandomBatch(POOL, used, 5);
    expect(batch).toHaveLength(5);
    expect(nextUsed).toHaveLength(5);
  });

  it('池小于 size 时返回整个池', () => {
    const smallPool = POOL.slice(0, 3);
    const { batch } = pickRandomBatch(smallPool, [], 5);
    expect(batch).toHaveLength(3);
  });

  it('空池返回空批次', () => {
    const { batch } = pickRandomBatch([], [], 5);
    expect(batch).toHaveLength(0);
  });

  it('used 里越界/无效索引被忽略', () => {
    const { batch, used } = pickRandomBatch(POOL, [999, -1], 5);
    expect(batch).toHaveLength(5);
    expect(used).toHaveLength(7);
  });
});
