import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackClock, DEFAULT_PLAYBACK_INTERVAL_MS, SEEK_SETTLE_TIMEOUT_MS } from '../services/playbackClock';

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

    vi.advanceTimersByTime(SEEK_SETTLE_TIMEOUT_MS - DEFAULT_PLAYBACK_INTERVAL_MS); // 未到兜底窗口
    expect(clock.getSnapshot().position).toBe(42);

    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 2); // 越过窗口 → 接受传输层真实位置
    expect(clock.getSnapshot().position).toBe(10);
  });

  it('小幅 seek（目标落在旧采样 ±1s 内）也不回跳，传输层响应后恢复采样', () => {
    position = 10;
    clock.setPlaying(true);
    clock.setPosition(10.5);
    expect(clock.getSnapshot().position).toBe(10.5);

    // 传输层尚未响应：采样仍是 10，与目标只差 0.5s——不得仅凭 ±1s 容差判成已追上
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS * 2);
    expect(clock.getSnapshot().position).toBe(10.5);

    // 传输层落地 → 恢复采样
    position = 10.8;
    vi.advanceTimersByTime(DEFAULT_PLAYBACK_INTERVAL_MS);
    expect(clock.getSnapshot().position).toBe(10.8);
  });
});

describe('逐字填充用的只读视图（#722：getPositionNow / isPlaying / 播放态订阅）', () => {
  it('isPlaying 跟着 setPlaying 变，且只在真实切换时通知', () => {
    const listener = vi.fn();
    clock.subscribePlaying(listener);
    expect(clock.isPlaying()).toBe(false);

    clock.setPlaying(true);
    expect(clock.isPlaying()).toBe(true);
    clock.setPlaying(true);
    expect(listener).toHaveBeenCalledTimes(1);

    clock.setPlaying(false);
    expect(clock.isPlaying()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('播放中直读传输层位置，而不是按快照外推（词边界与填充共用一个读数）', () => {
    position = 4;
    clock.setPosition(4);
    clock.setPlaying(true);

    position = 4.63;
    expect(clock.getPositionNow()).toBeCloseTo(4.63, 6);
    // 快照仍停在最近一次 250ms 采样值，进度条语义不变
    expect(clock.getSnapshot().position).toBe(4);
  });

  it('采样回退时按单调护栏夹住：最多退 50ms', () => {
    position = 10;
    clock.setPosition(10);
    clock.setPlaying(true);
    expect(clock.getPositionNow()).toBeCloseTo(10, 6);

    position = 9.5; // 传输层回退 500ms
    expect(clock.getPositionNow()).toBeCloseTo(9.95, 6);
    // 连续读不继续下沉（护栏是「见过的最高位置」，不是上次返回值）
    expect(clock.getPositionNow()).toBeCloseTo(9.95, 6);
    expect(clock.getPositionNow()).toBeCloseTo(9.95, 6);

    position = 9.98; // 回到护栏之上，跟随真实位置
    expect(clock.getPositionNow()).toBeCloseTo(9.98, 6);
  });

  it('setPosition / 暂停都会清掉护栏（seek 后退不被夹住）', () => {
    position = 10;
    clock.setPosition(10);
    clock.setPlaying(true);
    expect(clock.getPositionNow()).toBeCloseTo(10, 6);

    position = 2;
    clock.setPosition(2);
    expect(clock.getPositionNow()).toBeCloseTo(2, 6);

    position = 5;
    clock.setPlaying(false);
    position = 2.5;
    clock.setPlaying(true);
    expect(clock.getPositionNow()).toBeCloseTo(2.5, 6);
  });

  it('暂停与 seek 挂起时都回落到快照位置', () => {
    position = 4;
    clock.setPosition(4);
    clock.setPlaying(true);
    clock.setPlaying(false);
    position = 9;
    expect(clock.getPositionNow()).toBe(4);

    clock.setPosition(30); // seek 挂起：快照保持乐观目标
    clock.setPlaying(true);
    expect(clock.getPositionNow()).toBe(30);
  });
});
