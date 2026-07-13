import { create } from 'zustand';
import type { Song } from '@mplayer/core';

interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  // actions
  play: (song: Song) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  setQueue: (songs: Song[], startIndex?: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,

  play: (song) => set({ currentSong: song, isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    const { queue, currentIndex } = get();
    if (queue.length === 0 || currentIndex < 0) return;
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
}));
