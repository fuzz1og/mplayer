import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginInit,
  clearSourceSchedule,
  getSourceScheduleSnapshot,
  isInitialized,
  noteSample,
  orderSources,
  reward,
  scoreOf,
  SCHEDULE_CENSORED_WEIGHT,
  SCHEDULE_DEMOTE_AFTER,
  SCHEDULE_EWMA_ALPHA,
  SCHEDULE_SCORE_MS_CAP,
  type SourceSample,
} from '../sourceSchedule.js';

/**
 * 会话内源调度纯函数测试（#398 / ADR 2026-09-25 决策 1–6）。
 * 无 I/O、无 mock：三条不变量（候选集不变 / 冷启动顺序不变 / 每会话至多一个窗口）直接断言。
 */

const hit = (ms: number): SourceSample => ({ kind: 'complete', hit: true, ms });
const miss = (ms = 0): SourceSample => ({ kind: 'complete', hit: false, ms });
const censored = (wallMs: number): SourceSample => ({ kind: 'censored', hit: false, ms: wallMs });
const abandoned = (ms = 0): SourceSample => ({ kind: 'abandoned', hit: false, ms });

const list = (...ids: string[]): { id: string }[] => ids.map((id) => ({ id }));
const idsOf = (sources: readonly { id: string }[]): string[] => sources.map((s) => s.id);

beforeEach(() => {
  clearSourceSchedule();
});

describe('reward（决策 6：计分含耗时）', () => {
  it('命中：耗时越短分越高，3000ms 及以上归零', () => {
    expect(reward(true, 0)).toBe(1);
    expect(reward(true, 1_500)).toBeCloseTo(0.5, 10);
    expect(reward(true, SCHEDULE_SCORE_MS_CAP)).toBe(0);
    expect(reward(true, 9_000)).toBe(0);
  });

  it('未命中恒 0（耗时不参与）', () => {
    expect(reward(false, 0)).toBe(0);
    expect(reward(false, 120)).toBe(0);
  });

  it('负耗时按 0 夹取（不产生 >1 的分）', () => {
    expect(reward(true, -100)).toBe(1);
  });
});

describe('orderSources（决策 3 红线）', () => {
  it('候选集不变：输出是输入的排列，元素同一、既不删也不加', () => {
    const input = list('a', 'b', 'c');
    noteSample('b', hit(0));
    noteSample('c', miss());
    const out = orderSources(input);
    expect(out).toHaveLength(input.length);
    expect(new Set(out)).toEqual(new Set(input));
    for (const source of input) expect(out).toContain(source);
  });

  it('冷启动零行为变化：全部无样本时与输入逐元素同序', () => {
    expect(idsOf(orderSources(list('a', 'b', 'c', 'd')))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('有样本后按等效分降序，无样本源取中性分 0.5', () => {
    noteSample('a', hit(0)); // ≈0.65
    noteSample('c', miss()); // 0.35
    expect(idsOf(orderSources(list('a', 'b', 'c')))).toEqual(['a', 'b', 'c']);
  });

  it('连续失败 N=2 沉底（不删除、不禁用），成功一次即回归', () => {
    noteSample('a', hit(0));
    noteSample('a', hit(0)); // a ≈ 0.755
    noteSample('b', miss()); // b = 0.35
    expect(idsOf(orderSources(list('a', 'b')))).toEqual(['a', 'b']);

    // 1 次失败还不够降级（决策 3：N=2），且此时 a 的分仍高于 b → 位置不变
    noteSample('a', miss()); // a ≈ 0.5285
    expect(SCHEDULE_DEMOTE_AFTER).toBe(2);
    expect(getSourceScheduleSnapshot().a.demoted).toBe(false);
    expect(idsOf(orderSources(list('a', 'b')))).toEqual(['a', 'b']);

    // 第 2 次连续失败 → 降级分区优先于分数：a 的分仍高于 b，但沉到队尾
    noteSample('a', miss()); // a ≈ 0.37
    expect(getSourceScheduleSnapshot().a.demoted).toBe(true);
    expect(scoreOf('a')!).toBeGreaterThan(scoreOf('b')!);
    expect(idsOf(orderSources(list('a', 'b')))).toEqual(['b', 'a']);

    // 成功一次立即清零连续失败 → 回归按分排序（≈0.56 > 0.35）
    noteSample('a', hit(0));
    expect(getSourceScheduleSnapshot().a).toMatchObject({ consecutiveFailures: 0, demoted: false });
    expect(idsOf(orderSources(list('a', 'b')))).toEqual(['a', 'b']);
  });

  it('同分时保持清单内相对顺序（稳定排序）', () => {
    noteSample('a', hit(0));
    noteSample('b', hit(0));
    expect(idsOf(orderSources(list('b', 'a')))).toEqual(['b', 'a']);
  });
});

describe('noteSample / scoreOf（决策 6 三类分流）', () => {
  it('从未有计入样本 → scoreOf 返回 null（与 0 分区分）', () => {
    expect(scoreOf('nobody')).toBeNull();
  });

  it('完整观测：EWMA(α=0.3) 从中性分 0.5 起算', () => {
    noteSample('a', hit(0));
    expect(scoreOf('a')).toBeCloseTo(0.5 + SCHEDULE_EWMA_ALPHA * (1 - 0.5), 10);
    expect(scoreOf('a')).toBeCloseTo(0.65, 10);
    noteSample('a', hit(0));
    expect(scoreOf('a')).toBeCloseTo(0.65 + SCHEDULE_EWMA_ALPHA * (1 - 0.65), 10);
    expect(getSourceScheduleSnapshot().a.samples).toBe(2);
  });

  it('截尾样本降权 w=0.5：一次 2s 截尾只把分推到 0.425（完整未命中是 0.35）', () => {
    noteSample('slow', censored(2_000));
    expect(SCHEDULE_CENSORED_WEIGHT).toBe(0.5);
    expect(scoreOf('slow')).toBeCloseTo(0.5 - SCHEDULE_EWMA_ALPHA * 0.5 * 0.5, 10);
    expect(scoreOf('slow')).toBeCloseTo(0.425, 10);

    noteSample('dead', miss());
    expect(scoreOf('dead')).toBeCloseTo(0.35, 10);
    // 「没测到」比「确定没命中」轻：截尾源排在确定未命中的源之前
    expect(idsOf(orderSources(list('dead', 'slow')))).toEqual(['slow', 'dead']);
  });

  it('截尾同样累计连续失败（N=2 才降级）', () => {
    noteSample('slow', censored(2_000));
    noteSample('slow', censored(2_000));
    expect(getSourceScheduleSnapshot().slow).toMatchObject({ samples: 2, consecutiveFailures: 2, demoted: true });
  });

  it('放弃观测不进健康度：不改分、不改计数，只记 lastKind', () => {
    noteSample('a', hit(0));
    const before = scoreOf('a');
    noteSample('a', abandoned(1_200));
    expect(scoreOf('a')).toBe(before);
    expect(getSourceScheduleSnapshot().a).toMatchObject({ samples: 1, consecutiveFailures: 0, lastKind: 'abandoned' });
    // 只有放弃样本的源：lastKind 有记录，但不产生分数
    noteSample('never-asked', abandoned());
    expect(scoreOf('never-asked')).toBeNull();
    expect(getSourceScheduleSnapshot()['never-asked']).toMatchObject({ samples: 0, lastKind: 'abandoned' });
  });
});

describe('beginInit / isInitialized / clearSourceSchedule（决策 4/5 单飞）', () => {
  it('每会话至多一个窗口：并发取只成功一次（A4）', () => {
    expect(isInitialized()).toBe(false);
    const results = Array.from({ length: 5 }, () => beginInit());
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
    expect(isInitialized()).toBe(true);
    expect(beginInit()).toBe(false);
  });

  it('clearSourceSchedule 同时清空健康度与单飞标记', () => {
    beginInit();
    noteSample('a', hit(0));
    clearSourceSchedule();
    expect(isInitialized()).toBe(false);
    expect(scoreOf('a')).toBeNull();
    expect(getSourceScheduleSnapshot()).toEqual({});
    expect(beginInit()).toBe(true);
  });
});
