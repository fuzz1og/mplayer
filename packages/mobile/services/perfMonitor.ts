import { AppState } from 'react-native';
import { useLogsStore } from '../stores/logsStore';

/**
 * JS 帧率看门狗（掉帧埋点）。
 *
 * 背景：真机反馈「帧率暴降到 2fps」但本地难复现（场景性）。Perf Monitor 只在
 * 开发者手动打开时可见、且不留痕；这里常驻采样，**只在持续掉帧时**记一条 warn，
 * 附带现场（路由 / 播放器是否打开 / 窗口内最大帧间隔），便于事后从日志定位。
 *
 * 成本：每帧只做一次自增 + 一次 Date.now()，2s 结算一次；无订阅、无网络。
 */

/** 采样窗口（ms）：每个窗口结算一次帧率。 */
const SAMPLE_WINDOW_MS = 2000;
/** 低于该帧率视为掉帧（60Hz 下 30 = 掉一半）。 */
const LOW_FPS_THRESHOLD = 30;
/** 连续多少个窗口低于阈值才上报：滤掉单次抖动（滚动/转场本就会短暂掉帧）。 */
const LOW_STREAK_TO_REPORT = 2;
/**
 * 长窗口的判定倍数：超过 SAMPLE_WINDOW_MS 这么多倍才算「异常长窗口」。
 * 此时用 AppState 区分两种成因：
 * - 后台（rAF 被系统暂停）→ 只重置，不上报（否则会记出 `jsFps=0.1` 假警报）；
 * - **前台**（App 活着却长时间一帧都没跑）→ 这正是「卡死」本尊，必须上报。
 */
const PAUSE_ELAPSED_FACTOR = 3;

export interface PerfSample {
  /** 该窗口的平均 JS 帧率。 */
  fps: number;
  /** 该窗口内两帧之间的最大间隔（ms）：能抓到「卡死一下」的长任务。 */
  maxGapMs: number;
  at: number;
}

let raf = 0;
let frames = 0;
let windowStart = 0;
let lastFrameAt = 0;
let maxGapMs = 0;
let lowStreak = 0;
let lastSample: PerfSample | null = null;
let contextProvider: (() => string) | null = null;
let backgrounded = false;
let appStateSub: { remove: () => void } | null = null;

/** 注册掉帧上报时附带的现场（路由、播放器开合…），由 UI 层维护。 */
export function setPerfContext(fn: (() => string) | null): void {
  contextProvider = fn;
}

/** 最近一次采样（诊断 / 测试用）。 */
export function getLastPerfSample(): PerfSample | null {
  return lastSample;
}

/** 测试用：清空内部状态。 */
export function resetPerfMonitor(): void {
  frames = 0;
  windowStart = 0;
  lastFrameAt = 0;
  maxGapMs = 0;
  lowStreak = 0;
  lastSample = null;
}

function tick(): void {
  const now = Date.now();
  if (lastFrameAt) maxGapMs = Math.max(maxGapMs, now - lastFrameAt);
  lastFrameAt = now;
  frames += 1;
  const elapsed = now - windowStart;
  if (elapsed >= SAMPLE_WINDOW_MS) {
    if (elapsed > SAMPLE_WINDOW_MS * PAUSE_ELAPSED_FACTOR) {
      if (backgrounded) {
        // 后台：rAF 被系统暂停，不是性能问题
      } else {
        // 前台却长时间一帧未跑 = JS 线程卡死（rAF 也停了，只能事后补报）
        const ctx = contextProvider?.() ?? '';
        useLogsStore
          .getState()
          .addLog('warn', `[perf] JS 线程卡死 ${Math.round(elapsed)}ms（期间仅 ${frames} 帧）${ctx ? ' · ' + ctx : ''}`);
      }
      frames = 0;
      maxGapMs = 0;
      lowStreak = 0;
      windowStart = now;
      raf = requestAnimationFrame(tick);
      return;
    }
    const fps = (frames * 1000) / elapsed;
    lastSample = { fps, maxGapMs, at: now };
    if (fps < LOW_FPS_THRESHOLD) {
      lowStreak += 1;
      if (lowStreak >= LOW_STREAK_TO_REPORT) {
        const ctx = contextProvider?.() ?? '';
        useLogsStore
          .getState()
          .addLog(
            'warn',
            `[perf] JS 帧率 ${fps.toFixed(1)}fps（最大帧间隔 ${maxGapMs}ms）持续 ${lowStreak} 个窗口${ctx ? ' · ' + ctx : ''}`,
          );
        lowStreak = 0;
      }
    } else {
      lowStreak = 0;
    }
    frames = 0;
    maxGapMs = 0;
    windowStart = now;
  }
  raf = requestAnimationFrame(tick);
}

/** 启动看门狗（幂等）。 */
export function startPerfMonitor(): void {
  if (raf) return;
  backgrounded = AppState.currentState !== 'active';
  appStateSub = AppState.addEventListener('change', (s) => {
    backgrounded = s !== 'active';
  });
  frames = 0;
  maxGapMs = 0;
  lastFrameAt = 0;
  windowStart = Date.now();
  raf = requestAnimationFrame(tick);
}

/** 停止看门狗。 */
export function stopPerfMonitor(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  appStateSub?.remove();
  appStateSub = null;
}
