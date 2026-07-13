import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PlayMode = '顺序播放' | '单曲循环' | '随机播放';

export const PLAY_MODES: PlayMode[] = ['顺序播放', '单曲循环', '随机播放'];

interface SettingsState {
  apiBaseUrl: string;
  playMode: PlayMode;
  setApiBaseUrl: (url: string) => void;
  setPlayMode: (mode: PlayMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiBaseUrl: '',
      playMode: '顺序播放',
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setPlayMode: (mode) => set({ playMode: mode }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
