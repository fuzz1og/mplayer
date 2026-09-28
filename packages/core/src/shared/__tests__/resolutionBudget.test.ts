import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResolutionBudget, ResolutionBudgetExhaustedError } from '../resolutionBudget.js';
import { DIRECT_WALL_MS, RESOLUTION_CHAIN_BUDGET_MS, TIER3_CHAIN_BUDGET_MS } from '../playbackBudgets.js';

/**
 * 整链预算单测（#424）。
 *
 * 被测的是「可暂停的墙钟」这一件事：取小（clamp）、暂停不走表（tier3 K=3 排队）、
 * 到点触发监听并以哨兵错误结算、dispose 后彻底停表。
 */

describe('resolutionBudget（#424 解析链整链预算）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('缺省值 = 直连腿墙 + 一条 tier3 腿预算（「最坏等多久」是可读的单一值）', () => {
    expect(RESOLUTION_CHAIN_BUDGET_MS).toBe(9_000);
    expect(RESOLUTION_CHAIN_BUDGET_MS).toBe(DIRECT_WALL_MS + TIER3_CHAIN_BUDGET_MS);
    expect(createResolutionBudget().totalMs).toBe(RESOLUTION_CHAIN_BUDGET_MS);
  });

  it('clamp = min(本腿墙, 剩余预算)：不放大局部墙，剩余不足时按剩余给', () => {
    vi.useFakeTimers();
    const budget = createResolutionBudget(9_000);
    expect(budget.remainingMs()).toBe(9_000);
    expect(budget.clamp(DIRECT_WALL_MS)).toBe(3_000); // 局部墙更小 → 用局部墙
    vi.advanceTimersByTime(8_000);
    expect(budget.remainingMs()).toBe(1_000);
    expect(budget.clamp(DIRECT_WALL_MS)).toBe(1_000); // 剩余更小 → 用剩余
    expect(budget.clamp(500)).toBe(500);
    budget.dispose();
  });

  it('pause 期间不走表（tier3 K=3 排队不计入整链预算）', () => {
    vi.useFakeTimers();
    const budget = createResolutionBudget(9_000);
    vi.advanceTimersByTime(4_000);
    budget.pause();
    vi.advanceTimersByTime(60_000);
    expect(budget.remainingMs()).toBe(5_000);
    budget.resume();
    vi.advanceTimersByTime(5_000);
    expect(budget.remainingMs()).toBe(0);
    expect(budget.exhausted()).toBe(true);
    budget.dispose();
  });

  it('到点：onExpire 恰好触发一次，expired() 以 ResolutionBudgetExhaustedError 结算', async () => {
    vi.useFakeTimers();
    const budget = createResolutionBudget(1_000);
    const fired = vi.fn();
    budget.onExpire(fired);
    const assertion = expect(budget.expired()).rejects.toBeInstanceOf(ResolutionBudgetExhaustedError);
    await vi.advanceTimersByTimeAsync(999);
    expect(fired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fired).toHaveBeenCalledTimes(1);
    expect(budget.exhausted()).toBe(true);
    budget.dispose();
  });

  it('dispose 后停表：监听不再触发、expired 不再结算（链已自行收口）', async () => {
    vi.useFakeTimers();
    const budget = createResolutionBudget(1_000);
    const fired = vi.fn();
    budget.onExpire(fired);
    void budget.expired().catch(() => {});
    budget.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).not.toHaveBeenCalled();
    budget.dispose(); // 幂等
  });

  it('onExpire 的注销函数生效；已到点后注册立即触发一次', () => {
    vi.useFakeTimers();
    const budget = createResolutionBudget(1_000);
    const first = vi.fn();
    const off = budget.onExpire(first);
    off();
    vi.advanceTimersByTime(1_000);
    expect(first).not.toHaveBeenCalled();

    const late = vi.fn();
    budget.onExpire(late);
    expect(late).toHaveBeenCalledTimes(1);
    budget.dispose();
  });
});
