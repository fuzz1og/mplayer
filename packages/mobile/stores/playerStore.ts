import { create } from 'zustand';
import type { Song } from '@mplayer/core';

interface PlayerState {
  currentSong: Song | null;
  queue: Song[];
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
  isPlaying: false,
  currentTime: 0,
  duration: 0,

  play: (song) => set({ currentSong: song, isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),

  next: () => {
    const { queue, currentSong } = get();
    if (queue.length === 0 || !currentSong) return;
    const idx = queue.findIndex(s => s.id === currentSong.id);
    const nextIdx = (idx + 1) % queue.length;
    set({ currentSong: queue[nextIdx], isPlaying: true, currentTime: 0 });
  },

  prev: () => {
    const { queue, currentSong } = get();
    if (queue.length === 0 || !currentSong) return;
    const idx = queue.findIndex(s => s.id === currentSong.id);
    const prevIdx = (idx - 1 + queue.length) % queue.length;
    set({ currentSong: queue[prevIdx], isPlaying: true, currentTime: 0 });
  },

  setQueue: (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    set({ queue: songs, currentSong: songs[startIndex], isPlaying: true, currentTime: 0 });
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
}));
