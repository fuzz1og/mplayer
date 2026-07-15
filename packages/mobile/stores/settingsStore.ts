import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PlayMode = '单曲循环' | '随机播放' | '列表循环';

export const PLAY_MODES: PlayMode[] = ['单曲循环', '列表循环', '随机播放'];

interface SettingsState {
  apiBaseUrl: string;
  proxyUrl: string;
  playMode: PlayMode;
  setApiBaseUrl: (url: string) => void;
  setProxyUrl: (url: string) => void;
  setPlayMode: (mode: PlayMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiBaseUrl: '',
      proxyUrl: '',
      playMode: '列表循环',
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setProxyUrl: (url) => set({ proxyUrl: url }),
      setPlayMode: (mode) => set({ playMode: mode }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
