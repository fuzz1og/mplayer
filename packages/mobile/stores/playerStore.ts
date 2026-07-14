import { create } from 'zustand';
import type { Song } from '@mplayer/core';
import { useSettingsStore } from './settingsStore';

interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  showPlayer: boolean;
  // actions
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
  setShowPlayer: (show: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  showPlayer: false,

  play: (song) => set({ currentSong: song, isPlaying: true, currentTime: 0 }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0 || currentIndex < 0) return;
    const playMode = useSettingsStore.getState().playMode;

    if (playMode === '单曲循环') {
      // 重复同一首
      set({ currentTime: 0, isPlaying: true });
      return;
    }

    if (playMode === '随机播放') {
      const idx = Math.floor(Math.random() * queue.length);
      set({ currentSong: queue[idx], currentIndex: idx, isPlaying: true, currentTime: 0 });
      return;
    }

    // 顺序播放 / 列表循环
    const nextIdx = (currentIndex + 1) % queue.length;
    set({ currentSong: queue[nextIdx], currentIndex: nextIdx, isPlaying: true, currentTime: 0 });
  },

  prev: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0 || currentIndex < 0) return;
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    set({ currentSong: queue[prevIdx], currentIndex: prevIdx, isPlaying: true, currentTime: 0 });
  },

  setQueue: (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
    set({ queue: songs, currentSong: songs[idx], currentIndex: idx, isPlaying: true, currentTime: 0 });
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
  setShowPlayer: (show) => set({ showPlayer: show }),
}));
