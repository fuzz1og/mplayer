import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setSourceModePersister as setCoreSourceModePersister,
  loadSourceModes as loadCoreSourceModes,
  type SourceMode,
} from '@mplayer/core';

export type PlayMode = '单曲循环' | '随机播放' | '列表循环';

export const PLAY_MODES: PlayMode[] = ['单曲循环', '列表循环', '随机播放'];

interface SettingsState {
  apiBaseUrl: string;
  proxyUrl: string;
  playMode: PlayMode;
  /** Android SAF 授权的公共下载目录（content:// uri）；空 = 未授权，仅存应用私有目录 */
  downloadDirUri: string;
  /** 每源来源开关（T01，spec #146）：auto/direct/api */
  sourceModes: Partial<Record<string, SourceMode>>;
  setApiBaseUrl: (url: string) => void;
  setProxyUrl: (url: string) => void;
  setPlayMode: (mode: PlayMode) => void;
  setDownloadDirUri: (uri: string) => void;
  setSourceModes: (modes: Partial<Record<string, SourceMode>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiBaseUrl: '',
      proxyUrl: '',
      playMode: '列表循环',
      downloadDirUri: '',
      sourceModes: {},
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setProxyUrl: (url) => set({ proxyUrl: url }),
      setPlayMode: (mode) => set({ playMode: mode }),
      setDownloadDirUri: (uri) => set({ downloadDirUri: uri }),
      setSourceModes: (modes) => set({ sourceModes: modes }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // 移动端无主进程：core 来源开关 ↔ AsyncStorage 双向同步，store 即持久层。
      // core 变更 → persister 镜像进 store → persist 自动落盘；
      // 启动重水合 → 回灌 core 路由（loadCoreSourceModes）。
      onRehydrateStorage: () => (state) => {
        if (state?.sourceModes) {
          loadCoreSourceModes(state.sourceModes);
        }
      },
    }
  )
);

// 注册 core 来源开关持久化钩子（镜像进 store，persist 中间件负责 AsyncStorage）
setCoreSourceModePersister((modes) => {
  useSettingsStore.setState({ sourceModes: modes });
});
