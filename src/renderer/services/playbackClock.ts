import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * 播放时钟：桌面渲染进程的传输读模型。
 * 这里把三件事收进一个模块：
 * 到传输层追上目标前保持乐观值，并留超时兜底（传输层 seek 失败时不至于把进度条冻在目标位置）。
 */

export interface PlaybackSnapshot {
  /** 当前播放位置（秒） */
  position: number;
  /** 总时长（秒）；0 表示未知 */
  duration: number;
}

export interface PlaybackClockOptions {
  /** 采样间隔（毫秒）；默认 250ms，与旧 audioPlayer 轮询节奏一致 */
  intervalMs?: number;
}

export interface PlaybackClock {
  /** 绑定传输层位置采样源（只读）；重复绑定以最后一次为准 */
  connect(samplePosition: () => number): void;
  /** 订阅快照变化，返回解绑函数 */
  subscribe(listener: () => void): () => void;
  /** 订阅播放/暂停切换（快照语义不变：位置照旧 250ms 采样，只有播放态通知） */
  subscribePlaying(listener: () => void): () => void;
  /** 当前快照；未变化时保持同一对象引用（useSyncExternalStore 依赖此约定） */
  getSnapshot(): PlaybackSnapshot;
  /** 是否正在播放：暂停时 false（不随 tick 抖动） */
  isPlaying(): boolean;
  /** 按最近一次采样插值出的当前位置（秒）：暂停 / seek 挂起时等于快照位置 */
  getPositionNow(): number;
  /** 播放/暂停切换：暂停冻结采样，快照保留最后位置 */
  setPlaying(playing: boolean): void;
  /** 立即改写位置（seek/复播）；即使暂停中也要立刻反映 */
  setPosition(position: number): void;
  /** 时长由加载事件驱动（不参与采样） */
  setDuration(duration: number): void;
  /** 新曲/停止：位置与时长归零 */
  reset(): void;
  /** 停表并清空订阅（销毁播放器时用） */
  destroy(): void;
}

export const DEFAULT_PLAYBACK_INTERVAL_MS = 250;

/** seek 后「传输层已追上目标」的容差（秒）：HTML5 seek 落地位置可能有亚秒级误差。 */
export const SEEK_SETTLE_TOLERANCE_S = 1;
/** seek 乐观值的兜底存活时间（毫秒）：超时即恢复按传输层采样（seek 失败不冻结进度条）。 */
export const SEEK_SETTLE_TIMEOUT_MS = 1500;

export function createPlaybackClock(options: PlaybackClockOptions = {}): PlaybackClock {
  const intervalMs = options.intervalMs ?? DEFAULT_PLAYBACK_INTERVAL_MS;

  let snapshot: PlaybackSnapshot = { position: 0, duration: 0 };
  let samplePosition: () => number = () => 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** seek 乐观值：到传输层采样响应（相对 seek 前位置变化）且追上 target（或超时）之前，忽略采样结果 */
  let pendingSeek: { target: number; from: number; until: number } | null = null;
  /** 最近一次采样的墙钟时间（performance.now）：getPositionNow 从这里插值 */
  let lastTickAt = 0;
  const listeners = new Set<() => void>();
  const playingListeners = new Set<() => void>();

  // 只有真正变化才换快照对象并通知：值相同（含 undefined 之外的 NaN 比对交给 React）不打扰订阅者
  const emit = (next: Partial<PlaybackSnapshot>): void => {
    const position = next.position ?? snapshot.position;
    const duration = next.duration ?? snapshot.duration;
    if (position === snapshot.position && duration === snapshot.duration) return;
    snapshot = { position, duration };
    listeners.forEach((listener) => listener());
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = (): void => {
    const sampled = samplePosition();
    if (pendingSeek) {
      // 容差必须叠加「采样相对 seek 前位置已变化」：否则目标落在旧位置 ±1s 内的小幅 seek
      // 会被误判成传输层已追上，下一个 tick 立刻回跳（与大幅 seek 同一根因）。
      const responded = sampled !== pendingSeek.from;
      const settled =
        (responded && Math.abs(sampled - pendingSeek.target) <= SEEK_SETTLE_TOLERANCE_S)
        || Date.now() >= pendingSeek.until;
      // 传输层还没响应 seek：保持乐观位置，不把进度条拽回去
      if (!settled) return;
      pendingSeek = null;
    }
    lastTickAt = performance.now();
    emit({ position: sampled });
  };

  return {
    connect(nextSamplePosition) {
      samplePosition = nextSamplePosition;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribePlaying(listener) {
      playingListeners.add(listener);
      return () => {
        playingListeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    isPlaying: () => timer !== null,

    getPositionNow() {
      if (timer === null || pendingSeek !== null || lastTickAt === 0) return snapshot.position;
      // 只插值一个采样窗口：后台被节流时不要把位置甩出去
      const elapsedMs = Math.min(Math.max(performance.now() - lastTickAt, 0), intervalMs);
      return snapshot.position + elapsedMs / 1000;
    },

    setPlaying(playing) {
      const wasPlaying = timer !== null;
      if (!playing) {
        stopTimer();
      } else if (timer === null) {
        timer = setInterval(tick, intervalMs);
        tick();
      }
      if (wasPlaying !== (timer !== null)) playingListeners.forEach((listener) => listener());
    },

    setPosition(position) {
      const from = samplePosition();
      // 目标就是 seek 前位置（无位移 seek）：乐观值等于传输层真实值，不挂起——
      // 否则正常播放推进会被容差判定挡住，白等一个兜底窗口
      pendingSeek = position === from
        ? null
        : { target: position, from, until: Date.now() + SEEK_SETTLE_TIMEOUT_MS };
      lastTickAt = performance.now();
      emit({ position });
    },

    setDuration(duration) {
      emit({ duration });
    },

    reset() {
      pendingSeek = null;
      lastTickAt = performance.now();
      emit({ position: 0, duration: 0 });
    },

    destroy() {
      stopTimer();
      pendingSeek = null;
      lastTickAt = 0;
      listeners.clear();
      playingListeners.clear();
      samplePosition = () => 0;
      snapshot = { position: 0, duration: 0 };
    },
  };
}

/** 应用单例：playerStore 绑定传输层采样源，叶子组件订阅 */
export const playbackClock = createPlaybackClock();

/**
 * React 绑定：selector 的返回值按 Object.is 比较，没变就不重渲染。
 * selector 必须返回原始值或稳定引用（不要每次返回新对象）。
 */
export function usePlaybackSelector<T>(selector: (snapshot: PlaybackSnapshot) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  // 稳定的 getSelection：内部读最新 selector，避免每次渲染重新订阅
  const getSelection = useCallback(() => selectorRef.current(playbackClock.getSnapshot()), []);

  return useSyncExternalStore(playbackClock.subscribe, getSelection, getSelection);
}

/** 当前位置（秒） */
export function usePlaybackPosition(): number {
  return usePlaybackSelector((snapshot) => snapshot.position);
}

/** 当前时长（秒） */
export function usePlaybackDuration(): number {
  return usePlaybackSelector((snapshot) => snapshot.duration);
}

/** 是否正在播放（只读）：逐字填充的 rAF 循环靠它起停 */
export function usePlaybackPlaying(): boolean {
  return useSyncExternalStore(playbackClock.subscribePlaying, playbackClock.isPlaying, playbackClock.isPlaying);
}
