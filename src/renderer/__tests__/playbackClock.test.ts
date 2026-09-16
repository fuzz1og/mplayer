import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackClock, DEFAULT_PLAYBACK_INTERVAL_MS } from '../services/playbackClock';

/** 采样源：测试里手动改这个变量模拟传输层位置推进 */
let position = 0;
let clock: ReturnType<typeof createPlaybackClock>;

beforeEach(() => {
  vi.useFakeTimers();
  position = 0;
  clock = createPlaybackClock();
  clock.connect(() => position);
});

afterEach(() => {
  clock.destroy();
  vi.useRealTimers();
});

describe('playbackClock（桌面播放时钟：采样节奏 / 暂停 / seek / 窄订阅）', () => {
  it('播放中每个采样窗口至多一次通知（N 个窗口 → ≤ N 次）', () => {
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.setPlaying(true);

    for (let i = 1; i <= 8; i++) {
      position = i * 0.25;
      vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS);
    }

    expect(listener).toHaveBeenCalledTimes(8);
    expect(clock.getSnapshot().position).toBe(2);
  });

  it('位置未变化的采样不打扰订阅者（缓冲/暂停边缘不再空转）', () => {
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.setPlaying(true);

    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 4);

    expect(listener).not.toHaveBeenCalled();
  });

  it('暂停冻结时钟：快照停在最后位置，恢复后继续走表', () => {
    position = 10;
    clock.setPosition(10);

    const listener = vi.fn();
    clock.subscribe(listener);
    clock.setPlaying(true);
    expect(listener).not.toHaveBeenCalled(); // 立即采样与当前快照一致

    position = 12;
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.getSnapshot().position).toBe(12);

    clock.setPlaying(false);
    position = 99;
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 8);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.getSnapshot().position).toBe(12);

    clock.setPlaying(true);
    expect(clock.getSnapshot().position).toBe(99);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('seek 立即改写快照并通知（暂停中也立即反映），同值不重复通知', () => {
    const listener = vi.fn();
    clock.subscribe(listener);

    clock.setPosition(42);
    expect(clock.getSnapshot().position).toBe(42);
    expect(listener).toHaveBeenCalledTimes(1);

    clock.setPosition(42);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('时长由加载事件驱动，不参与采样', () => {
    const listener = vi.fn();
    clock.subscribe(listener);

    clock.setDuration(240);
    expect(clock.getSnapshot()).toEqual({ position: 0, duration: 240 });
    expect(listener).toHaveBeenCalledTimes(1);

    clock.setPlaying(true);
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 2);
    expect(clock.getSnapshot().duration).toBe(240);
  });

  it('reset 归零位置与时长（新曲/停止）', () => {
    clock.setPosition(30);
    clock.setDuration(180);

    clock.reset();

    expect(clock.getSnapshot()).toEqual({ position: 0, duration: 0 });
  });

  it('快照未变化时保持同一对象引用（useSyncExternalStore 依赖）', () => {
    const first = clock.getSnapshot();
    clock.setPosition(0);
    expect(clock.getSnapshot()).toBe(first);

    clock.setPosition(1);
    expect(clock.getSnapshot()).not.toBe(first);
  });

  it('destroy 停表并停止通知', () => {
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.setPlaying(true);
    expect(vi.getTimerCount()).toBe(1);

    clock.destroy();
    position = 5;
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 4);

    expect(vi.getTimerCount()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('seek 后传输层尚未追上时保持乐观位置（不回跳），追平后恢复采样', () => {
    position = 10;
    clock.setPlaying(true);
    clock.setPosition(42);
    expect(clock.getSnapshot().position).toBe(42);

    // HTML5 media 的 currentTime 赋值是异步的：采样仍读到旧值 10，
    // 不得把刚 seek 到的 42 拽回去（进度条回跳）
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 2);
    expect(clock.getSnapshot().position).toBe(42);

    // 传输层追平（容差内）→ 恢复正常采样
    position = 42.4;
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS);
    expect(clock.getSnapshot().position).toBe(42.4);
  });

  it('seek 后传输层始终追不上：超时兜底恢复采样（不把进度条冻结在目标位置）', () => {
    position = 10;
    clock.setPlaying(true);
    clock.setPosition(42);

    vi.advanceTimersByTime(1000); // 未到 1500ms 兜底窗口
    expect(clock.getSnapshot().position).toBe(42);

    vi.advanceTimersByTime(1000); // 越过窗口 → 接受传输层真实位置
    expect(clock.getSnapshot().position).toBe(10);
  });
});
