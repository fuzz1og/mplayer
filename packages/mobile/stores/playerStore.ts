import { create } from 'zustand'
import type { Song } from '@mplayer/core'
import { getNextSongIndex } from '@mplayer/core'
import { useSettingsStore } from './settingsStore'
import { prefetchKey } from '../services/queuePrefetch'
import { planPlayNext } from '../services/queueInsert'

interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  showPlayer: boolean;
  /** 播放准备中（解析直链/创建播放器）：UI 显示加载反馈，避免点击后无响应感 */
  preparing: boolean;
  /** 是否曾播放过（ADR-0008）：首次播放前隐藏迷你播放栏，此后队列清空仍显示空态 */
  hasPlayed: boolean;
  // actions
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  next: () => Song | null;
  prev: () => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  /**
   * 「下一首播放」（#495）：把 `song` 放到当前曲之后。
   *
   * 与桌面 #506（`playerStore.insertNext`）和 Android `QueueStore.insertAfterCurrent`
   * 同一套语义：已在队列 → **移动**（不复制、保留队列里那份对象、长度不变）；不在 → 插入；
   * 已在下一首位置 / 就是当前曲 → no-op（连点幂等）；当前曲不被打断。
   *
   * `started = true`：队列为空 / 没有当前曲（currentIndex < 0）→ **等价于开始播放这首**
   * （与桌面 #506 同口径），调用方据此决定要不要真正起播。
   * `moved` = 从队列别处移动过来。
   */
  insertNext: (song: Song) => { started: boolean; moved: boolean; noop: boolean };
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
  setShowPlayer: (show: boolean) => void;
  setPreparing: (preparing: boolean) => void;
  /**
   * 原生对账入口（规格 §4.3）：后台期间队列索引的真相源是原生，
   * 回前台/事件到达时**单向**把原生状态写进 store。禁止双向写（否则出现第二个真相源）。
   * 只覆盖传入的字段，未传字段保持 store 现值。
   */
  applyNativeState: (patch: {
    song?: Song | null;
    index?: number;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
  }) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  showPlayer: false,
  preparing: false,
  hasPlayed: false,

  play: (song) => set({ currentSong: song, isPlaying: true, currentTime: 0, hasPlayed: true }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    const { queue, currentIndex } = get();
    const playMode = useSettingsStore.getState().playMode;
    const nextIndex = getNextSongIndex(queue, currentIndex, playMode);
    if (nextIndex === -1) return null;
    set({ currentSong: queue[nextIndex], currentIndex: nextIndex, isPlaying: true, currentTime: 0, hasPlayed: true });
    return get().currentSong;
  },

  prev: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0 || currentIndex < 0) return;
    const playMode = useSettingsStore.getState().playMode;

    if (playMode === '单曲循环') {
      set({ currentTime: 0, isPlaying: true });
      return;
    }

    if (playMode === '随机播放') {
      const idx = Math.floor(Math.random() * queue.length);
      set({ currentSong: queue[idx], currentIndex: idx, isPlaying: true, currentTime: 0 });
      return;
    }

    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    set({ currentSong: queue[prevIdx], currentIndex: prevIdx, isPlaying: true, currentTime: 0 });
  },

  insertNext: (song) => {
    const { queue, currentIndex, currentSong } = get();
    // 队列为空 / 没有当前曲：没有「当前曲之后」这个位置 → 等价于开始播放这首（桌面 #506 同口径）
    if (queue.length === 0 || currentIndex < 0 || !currentSong) {
      set({
        queue: queue.length === 0 ? [song] : queue,
        currentIndex: queue.length === 0 ? 0 : currentIndex,
        currentSong: song,
        isPlaying: true,
        currentTime: 0,
        hasPlayed: true,
      });
      return { started: true, moved: false, noop: false };
    }
    // 当前曲的 index 优先按 key 反查（`play()` 只写 currentSong、不写 currentIndex），
    // 反查不到才退回 currentIndex。
    const byKey = queue.findIndex((s) => prefetchKey(s) === prefetchKey(currentSong));
    const current = byKey >= 0 ? byKey : Math.min(Math.max(currentIndex, 0), queue.length - 1);
    const plan = planPlayNext(queue, current, song, useSettingsStore.getState().playMode);
    if (plan.noop) return { started: false, moved: false, noop: true };
    // currentIndex 由 indexOf(currentSong) 重新推导，`next()` 因此仍指向同一首
    const nextCurrent = plan.sequence.findIndex((s) => prefetchKey(s) === prefetchKey(currentSong));
    set({
      queue: plan.sequence,
      currentIndex: nextCurrent >= 0 ? nextCurrent : currentIndex,
      hasPlayed: true,
    });
    return { started: false, moved: plan.moved, noop: false };
  },

  setQueue: (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
    set({ queue: songs, currentSong: songs[idx], currentIndex: idx, isPlaying: true, currentTime: 0, hasPlayed: true });
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
  setShowPlayer: (show) => set({ showPlayer: show }),
  setPreparing: (preparing) => set({ preparing }),

  applyNativeState: (patch) => {
    const next: Partial<PlayerState> = {};
    if (patch.song !== undefined && patch.song) {
      next.currentSong = patch.song;
      next.hasPlayed = true;
    }
    if (patch.index !== undefined && patch.index >= 0) next.currentIndex = patch.index;
    if (patch.isPlaying !== undefined) next.isPlaying = patch.isPlaying;
    if (patch.currentTime !== undefined && Number.isFinite(patch.currentTime)) {
      next.currentTime = patch.currentTime;
    }
    if (patch.duration !== undefined && Number.isFinite(patch.duration) && patch.duration > 0) {
      next.duration = patch.duration;
    }
    if (Object.keys(next).length > 0) set(next);
  },
}));
