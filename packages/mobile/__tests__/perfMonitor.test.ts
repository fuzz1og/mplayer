import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startPerfMonitor,
  stopPerfMonitor,
  resetPerfMonitor,
  setPerfContext,
  getLastPerfSample,
} from '../services/perfMonitor';
import { useLogsStore } from '../stores/logsStore';

// node 测试环境无法解析 react-native 的 Flow 源码（`import typeof`）；只用到 AppState，
// 这里替换成最小假实现（本模块的暂停/卡死判定只依赖 currentState 与 change 事件）。
const mockAppState = vi.hoisted(() => ({
  currentState: 'active' as string,
  listener: null as ((s: string) => void) | null,
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppState.currentState;
    },
    addEventListener: (_type: string, cb: (s: string) => void) => {
      mockAppState.listener = cb;
      return { remove: () => {} };
    },
  },
}));

/**
 * JS 帧率看门狗（掉帧埋点）单测：只验外部行为——什么条件下记日志、记了什么现场。
 * 用可控 rAF + 假时钟驱动，不依赖真实帧。
 */

let pending: FrameRequestCallback | null = null;
let now = 1_000_000;

/** 推进 count 帧、每帧间隔 stepMs（触发窗口结算）。 */
const runFrames = (count: number, stepMs: number) => {
  for (let i = 0; i < count; i++) {
    now += stepMs;
    const cb = pending;
    pending = null;
    cb?.(now);
  }
};

const perfEntries = () => useLogsStore.getState().entries.filter((e) => e.message.includes('[perf]'));

beforeEach(() => {
  pending = null;
  now = 1_000_000;
  mockAppState.currentState = 'active';
  mockAppState.listener = null;
  resetPerfMonitor();
  useLogsStore.getState().clearLogs();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null;
  });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  stopPerfMonitor();
  setPerfContext(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('perfMonitor 掉帧看门狗', () => {
  it('持续低帧率（2fps）连续两个窗口 → 记一条 warn，含帧率与现场', () => {
    setPerfContext(() => 'route=/history player=closed');
    startPerfMonitor();

    runFrames(4, 500); // 窗口 1：2000ms 内 4 帧 = 2fps
    expect(perfEntries()).toHaveLength(0); // 只掉一个窗口不上报（滤抖动）
    runFrames(4, 500); // 窗口 2：仍 2fps → 连续 2 个窗口

    const entries = perfEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].message).toContain('2.0fps');
    expect(entries[0].message).toContain('route=/history player=closed');
  });

  it('单窗口掉帧后恢复正常 → 不记日志（连续计数被重置）', () => {
    startPerfMonitor();

    runFrames(4, 500); // 窗口 1：2fps（streak=1）
    runFrames(120, 17); // 窗口 2：~59fps → streak 归零
    runFrames(4, 500); // 窗口 3：2fps（streak=1，还不到 2）

    expect(perfEntries()).toHaveLength(0);
  });

  it('采样记录窗口内最大帧间隔（抓长任务卡顿）', () => {
    startPerfMonitor();
    runFrames(3, 200);
    now += 1200; // 一次 1.2s 的 JS 阻塞
    runFrames(3, 200); // 跨过窗口边界触发结算

    expect(getLastPerfSample()?.maxGapMs).toBeGreaterThanOrEqual(1200);
  });

  it('rAF 被后台暂停后恢复 → 不误报掉帧（长窗口只重置）', () => {
    mockAppState.currentState = 'background';
    startPerfMonitor();
    now += 200_000; // App 在后台待了 200s（rAF 暂停）
    runFrames(1, 0);

    expect(perfEntries()).toHaveLength(0);
  });

  it('前台长时间一帧未跑 → 上报「JS 线程卡死」（区别于后台暂停）', () => {
    startPerfMonitor();
    now += 30_000; // 前台卡死 30s：rAF 完全没跑
    runFrames(1, 0);

    const entries = perfEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain('卡死');
    expect(entries[0].message).toContain('30000ms');
  });

  it('start 幂等：重复调用不会挂两个 rAF 循环', () => {
    startPerfMonitor();
    const first = pending;
    startPerfMonitor();
    expect(pending).toBe(first);
  });
});
