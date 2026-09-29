import { create } from 'zustand'
import type { Song } from '@mplayer/core'
import { getNextSongIndex } from '@mplayer/core'
import { useSettingsStore } from './settingsStore'

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
