/**
 * 拖拽跟手卡顿探针（#430）：把纯内核 gestures/dragJank 接到日志通道与 perf 现场。
 *
 * 上报策略（与 perfMonitor 同一哲学——常态不刷屏）：
 *   - **跟手掉帧的手势：一律 warn**，release 构建上也能从 logcat / 应用内日志拿到；
 *   - **干净的手势：只在诊断开启（dev 构建或开发者模式）记 info** —— A/B 需要「没掉帧」也有正证据，
 *     否则「零 warn」既可能是真没卡、也可能是探针根本没跑
 *     （见 runtime-verification skill 里对 perfMonitor 的同款告诫）。
 *
 * 判语本身在纯内核里（gestures/dragJank），这里只管绑定真实时钟、日志、面板归属与活动状态。
 */
import { createDragJankMeter, formatDragJank, isJanky } from '../gestures/dragJank';
import { useLogsStore } from '../stores/logsStore';
import { isDiagnosticsEnabled } from './devMode';

/**
 * 「刚拖过」的判定窗口（ms）。存在的理由：perfMonitor 的帧率分支要**连续 2 个 2s 窗口**
 * 达标才上报，即告警最早也在拖拽结束后 4s 才落盘——只用「此刻在不在拖」的瞬时状态做现场，
 * 那行告警永远显示「没在拖」，等于没接。见 describeDragActivity。
 */
export const RECENT_DRAG_MS = 10_000;

const meter = createDragJankMeter();
let active = false;
let label = 'unknown';
let lastEndedAt = -1;
let lastJanky = false;

/** 手势认领（PanResponderGrant）：开启一次采样。label = 拖拽接入点名 */
export function beginDragProbe(at: number, surface = 'unknown'): void {
  active = true;
  label = surface;
  meter.start();
}

/** move 回调：记一个观测点 */
export function sampleDragProbe(at: number): void {
  if (!active) return;
  meter.sample(at);
}

/** 松手 / 被系统抢走 / 宿主卸载：算结论并按策略上报 */
export function endDragProbe(at: number): void {
  if (!active) return;
  active = false;
  const report = meter.finish(at);
  if (!report) return; // 样本太少（轻点 / 微拖）：不给结论，也不冒充「正常」
  lastEndedAt = at;
  lastJanky = isJanky(report);
  const message = formatDragJank(report, label);
  if (lastJanky) useLogsStore.getState().addLog('warn', message);
  else if (isDiagnosticsEnabled()) useLogsStore.getState().addLog('info', message);
}

/**
 * 给 perfMonitor 的现场用：此刻在拖 / 刚拖过（掉帧与否）/ 无关。
 * 必须覆盖「刚拖过」——告警落盘时刻晚于手势结束是常态（见 RECENT_DRAG_MS）。
 */
export function describeDragActivity(now: number): 'on' | 'recent-janky' | 'recent-clean' | 'off' {
  if (active) return 'on';
  if (lastEndedAt >= 0 && now - lastEndedAt <= RECENT_DRAG_MS) {
    return lastJanky ? 'recent-janky' : 'recent-clean';
  }
  return 'off';
}

/** 测试用：清空模块状态 */
export function resetDragProbe(): void {
  active = false;
  label = 'unknown';
  lastEndedAt = -1;
  lastJanky = false;
}
