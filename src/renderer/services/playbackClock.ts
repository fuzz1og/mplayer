import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * 播放时钟：桌面渲染进程的传输读模型。
 *
 * 播放位置/时长是高频值（250ms 一发），以前它们是 playerStore 的全局字段——
 * 任何模块都能订阅，于是每个采样 tick 都要过一遍全局订阅面（PlayerBar、
 * LyricsPage、全量歌词行的重渲染）。这里把三件事收进一个模块：
 *
 * - 采样节奏（唯一的 setInterval，只读传输层当前位置）
 * - 暂停/seek 语义（暂停冻结快照；seek 立即改写并通知，暂停中同样立即反映）
 * - 窄订阅（subscribe + getSnapshot；React 侧经 usePlaybackSelector 按
 *   Object.is 比较派生值，派生值没变就不重渲染）
 *
 * 谁用谁订阅：进度条订阅 position/duration，歌词高亮只订阅「当前行序号」。
 * 传输层（audioPlayer）只保留 play/pause/seek/getPosition，不再自己轮询。
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
  /** 当前快照；未变化时保持同一对象引用（useSyncExternalStore 依赖此约定） */
  getSnapshot(): PlaybackSnapshot;
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

export function createPlaybackClock(options: PlaybackClockOptions = {}): PlaybackClock {
  const intervalMs = options.intervalMs ?? DEFAULT_PLAYBACK_INTERVAL_MS;

  let snapshot: PlaybackSnapshot = { position: 0, duration: 0 };
  let samplePosition: () => number = () => 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

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
    emit({ position: samplePosition() });
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

    getSnapshot: () => snapshot,

    setPlaying(playing) {
      if (!playing) {
        stopTimer();
        return;
      }
      if (timer !== null) return;
      timer = setInterval(tick, intervalMs);
      tick();
    },

    setPosition(position) {
      emit({ position });
    },

    setDuration(duration) {
      emit({ duration });
    },

    reset() {
      emit({ position: 0, duration: 0 });
    },

    destroy() {
      stopTimer();
      listeners.clear();
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
