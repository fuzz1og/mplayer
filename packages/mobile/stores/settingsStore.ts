import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setSourceModePersister as setCoreSourceModePersister,
  loadSourceModes as loadCoreSourceModes,
  sanitizeSourceModes,
  setTier3Persister as setCoreTier3Persister,
  loadTier3State as loadCoreTier3State,
  setTier3Enabled as setCoreTier3Enabled,
  setTier3Subscriptions as setCoreTier3Subscriptions,
  type SourceMode,
  type Tier3Subscription,
  type Tier3State,
} from '@mplayer/core';
import type { ThemeMode } from '../theme/tokens';

export type PlayMode = '单曲循环' | '随机播放' | '列表循环';

export const PLAY_MODES: PlayMode[] = ['单曲循环', '列表循环', '随机播放'];

interface SettingsState {
  proxyUrl: string;
  playMode: PlayMode;
  /** Android SAF 授权的公共下载目录（content:// uri）；空 = 未授权，仅存应用私有目录 */
  downloadDirUri: string;
  /** 每源来源开关（T01，spec #146）：auto/direct（#277 收窄，legacy 'api' 洗白为 auto） */
  sourceModes: Partial<Record<string, SourceMode>>;
  /** tier3 第三方解析源（#144）：默认关，订阅清单存 AsyncStorage */
  tier3Enabled: boolean;
  tier3Subscriptions: Tier3Subscription[];
  /** 更新下载通道（#262/#263）：'auto' 测速择优，或指定源 id；镜像优先、直连垫底 */
  updateChannel: string;
  /** 主题模式（#173）：system 跟随系统深浅色，light/dark 手动指定 */
  themeMode: ThemeMode;
  setProxyUrl: (url: string) => void;
  setPlayMode: (mode: PlayMode) => void;
  setDownloadDirUri: (uri: string) => void;
  setSourceModes: (modes: Partial<Record<string, SourceMode>>) => void;
  setTier3Enabled: (enabled: boolean) => void;
  setTier3Subscriptions: (subscriptions: Tier3Subscription[]) => void;
  setUpdateChannel: (channel: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      proxyUrl: '',
      playMode: '列表循环',
      downloadDirUri: '',
      sourceModes: {},
      tier3Enabled: false,
      tier3Subscriptions: [],
      updateChannel: 'auto',
      themeMode: 'system',
      setProxyUrl: (url) => set({ proxyUrl: url }),
      setPlayMode: (mode) => set({ playMode: mode }),
      setDownloadDirUri: (uri) => set({ downloadDirUri: uri }),
      setSourceModes: (modes) => set({ sourceModes: modes }),
      setTier3Enabled: (enabled) => setCoreTier3Enabled(enabled),
      setTier3Subscriptions: (subscriptions) => setCoreTier3Subscriptions(subscriptions),
      setUpdateChannel: (channel) => set({ updateChannel: channel }),
      setThemeMode: (mode) => set({ themeMode: mode }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // 移动端无主进程：core 来源开关 ↔ AsyncStorage 双向同步，store 即持久层。
      // core 变更 → persister 镜像进 store → persist 自动落盘；
      // 启动重水合 → 回灌 core 路由（loadCoreSourceModes）。
      onRehydrateStorage: () => (state) => {
        if (state?.sourceModes) {
          // 存量 legacy 'api' 洗白为 'auto'（#277）：回灌 core 路由 + 回写 store
          // （setState 触发 persist 中间件把洗白后的数据落回 AsyncStorage）。
          const clean = sanitizeSourceModes(state.sourceModes);
          loadCoreSourceModes(clean);
          if (JSON.stringify(clean) !== JSON.stringify(state.sourceModes)) {
            useSettingsStore.setState({ sourceModes: clean });
          }
        }
        if (Array.isArray(state?.tier3Subscriptions)) {
          loadCoreTier3State({
            enabled: !!state?.tier3Enabled,
            subscriptions: state?.tier3Subscriptions || [],
          });
        }
      },
    }
  )
);

// 注册 core 来源开关持久化钩子（镜像进 store，persist 中间件负责 AsyncStorage）
setCoreSourceModePersister((modes) => {
  useSettingsStore.setState({ sourceModes: modes });
});

// 注册 core tier3 订阅状态持久化钩子（#144）：core 变更 → store → AsyncStorage
setCoreTier3Persister((next: Tier3State) => {
  useSettingsStore.setState({ tier3Enabled: next.enabled, tier3Subscriptions: next.subscriptions });
});
