import type { PlaybackGuard, PlaybackVia } from './playbackGuard.js';

/**
 * 播放解析链结构化 trace（#363 / t5 埋点形态决策）。
 *
 * 形态：**core 出结构化 trace，宿主落 sink**——core 内保持零 I/O，只把一次解析
 * 的语义（命中层级、各段耗时、每源 outcome、护栏等级）交给宿主注册的 sink；
 * 宿主负责常驻环形缓冲、设置页展示与手动导出。
 *
 * 开销约束：sink 为空时热路径**零构造**——调用方先 `isPlaybackTraceEnabled()`，
 * 关闭时连 `traceNow()` 都不调用（见 sourceRouter / tier3Api 的用法）。
 */

/** 命中层级：用户可感知的「这次从哪一层拿到 URL」。 */
export type PlaybackLayer = 'prefetch' | 'direct' | 'tier3' | 'fail';

/** 单源 outcome：hit=产出候选；rejected=候选未过护栏；discarded=迟到命中被预算丢弃。 */
export type PlaybackTraceOutcome = 'hit' | 'miss' | 'error' | 'skipped' | 'rejected' | 'discarded';

/** 失败分类：只做粗分，够设置页归因即可。 */
export type PlaybackTraceErrorClass = 'timeout' | 'tls' | 'http4xx' | 'http5xx' | 'empty' | 'unknown';

/** tier3 源循环里每源一条。 */
export interface PlaybackTraceSourceLeg {
  sourceId: string;
  /** 该源本次耗时（ms）；skipped 为 0。 */
  ms: number;
  outcome: PlaybackTraceOutcome;
  errorClass?: PlaybackTraceErrorClass;
  guard?: PlaybackGuard;
}

/** 一次 `resolvePlayableSongRouted` 的完整 trace。 */
export interface PlaybackTrace {
  /** 记录时刻（`traceNow()` 的时钟）。 */
  ts: number;
  songId: string;
  songName: string;
  artist: string;
  sourceType: string;
  totalMs: number;
  layer: PlaybackLayer;
  /** 结果是否为试听版（非完整版）。 */
  nonFull: boolean;
  /** 是否命中预取缓存（完整版命中即 0 等待；试听版命中仍可能进 tier3）。 */
  prefetchHit: boolean;
  /** 本次是否进入过 tier3 腿。 */
  tier3Engaged: boolean;
  /** 触发原因 / 结果说明（如「直连返回空串（无版权/VIP）」「预取缓存命中」）。 */
  reason: string;
  /** 来源腿（成功时）；失败为 null。 */
  via: PlaybackVia | null;
  /** 护栏等级（tier3 腿成功时）；直连/失败为 null。 */
  guard: PlaybackGuard | null;
  /** 直连腿耗时（进入过直连解析时）。 */
  directMs: number | null;
  directMethod: string | null;
  directSource: string | null;
  /** 直连腿是否被 3s 墙钟截断（#389）：截断即视为该腿失败 → 进 tier3 兜底。 */
  directTimedOut: boolean;
  /** 直连腿播放时时长取证耗时（#392）；未取证为 null。 */
  validateMs: number | null;
  /** tier3 腿耗时与是否被整链预算截断。 */
  tier3Ms: number | null;
  tier3TimedOut: boolean;
  /** 每源 outcome（含 skipped/rejected/迟到 discarded）。 */
  sources: PlaybackTraceSourceLeg[];
}

/** 一次 `probeSongsBatch` 单曲的 trace：URL 校验成本单独记，不并入解析腿。 */
export interface PlaybackProbeTrace {
  ts: number;
  songId: string;
  /** 直连解析耗时（resolvePlayableSongDirect）。 */
  resolveMs: number;
  /** URL 探活/校验耗时（probeAudioUrl）。 */
  validateMs: number;
  tag: string;
}

/** 宿主注册的 sink；两个回调都可选。 */
export interface PlaybackTraceSink {
  onResolve?(trace: PlaybackTrace): void;
  onProbe?(trace: PlaybackProbeTrace): void;
}

let sink: PlaybackTraceSink | null = null;

/** 注册/清除 sink（与 setTier3Persister 等既有接缝同构）。null = 关闭，热路径零成本。 */
export function setPlaybackTraceSink(next: PlaybackTraceSink | null): void {
  sink = next;
}

export function getPlaybackTraceSink(): PlaybackTraceSink | null {
  return sink;
}

/** 热路径唯一判断入口：false 时调用方不得构造任何记录。 */
export function isPlaybackTraceEnabled(): boolean {
  return sink !== null;
}

export function emitPlaybackTrace(trace: PlaybackTrace): void {
  sink?.onResolve?.(trace);
}

export function emitPlaybackProbeTrace(trace: PlaybackProbeTrace): void {
  sink?.onProbe?.(trace);
}

/** 统一时钟：优先 performance.now（亚毫秒），退化到 Date.now。 */
export function traceNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** 粗分错误类型，供每源 leg 的 errorClass。 */
export function classifyTraceError(err: unknown): PlaybackTraceErrorClass {
  const msg = String((err as Error)?.message || err || '');
  const code = String((err as { code?: string })?.code || '');
  if (/ECONNABORTED|ETIMEDOUT|timeout|超时/i.test(msg) || /ECONNABORTED|ETIMEDOUT/.test(code)) return 'timeout';
  if (/TLS|handshake|ECONNRESET|EPROTO|socket hang up/i.test(msg) || /ECONNRESET|EPROTO/.test(code)) return 'tls';
  if (/\b4\d\d\b|403|404|401/.test(msg)) return 'http4xx';
  if (/\b5\d\d\b/.test(msg)) return 'http5xx';
  if (/empty|空/i.test(msg)) return 'empty';
  return 'unknown';
}

/** 宿主常驻内存环形缓冲（会话内、不落盘、不外传）。容量建议 200。 */
export interface PlaybackTraceRing {
  sink: PlaybackTraceSink;
  listResolves(): PlaybackTrace[];
  listProbes(): PlaybackProbeTrace[];
  clear(): void;
}

export function createPlaybackTraceRing(capacity = 200): PlaybackTraceRing {
  const cap = Math.max(1, capacity);
  const resolves: PlaybackTrace[] = [];
  const probes: PlaybackProbeTrace[] = [];
  const push = <T>(arr: T[], item: T): void => {
    if (arr.length >= cap) arr.shift();
    arr.push(item);
  };
  return {
    sink: {
      onResolve: (t) => push(resolves, t),
      onProbe: (t) => push(probes, t),
    },
    listResolves: () => [...resolves],
    listProbes: () => [...probes],
    clear: () => {
      resolves.length = 0;
      probes.length = 0;
    },
  };
}
