import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setSourceModes, getSourceMode, loadSourceModes } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * settingsStore ↔ core 来源开关双向同步测试（T01）：
 * - core 变更 → persister 镜像进 store（persist 中间件负责 AsyncStorage 落盘）；
 * - 启动重水合 → onRehydrateStorage 回灌 core 路由。
 */

beforeEach(() => {
  loadSourceModes({});
  useSettingsStore.setState({ sourceModes: {} });
  vi.clearAllMocks();
});

describe('settingsStore ↔ core 来源开关双向同步', () => {
  it('core setSourceModes → persister 镜像进 store（持久化方向）', () => {
    setSourceModes({ netease: 'direct', qq: 'api' });
    expect(useSettingsStore.getState().sourceModes).toEqual({ netease: 'direct', qq: 'api' });
  });

  it('rehydrate 时回灌 core 路由（启动方向）', async () => {
    (AsyncStorage.getItem as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ state: { sourceModes: { qq: 'api' } }, version: 0 }),
    );
    await useSettingsStore.persist.rehydrate();
    expect(getSourceMode('qq')).toBe('api');
    expect(useSettingsStore.getState().sourceModes).toEqual({ qq: 'api' });
  });
});
