import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setSourceModes, getSourceMode, loadSourceModes, setTier3Enabled, getTier3State, loadTier3State } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * settingsStore ↔ core 来源开关双向同步测试（T01）：
 * - core 变更 → persister 镜像进 store（persist 中间件负责 AsyncStorage 落盘）；
 * - 启动重水合 → onRehydrateStorage 回灌 core 路由。
 * 同时覆盖 tier3 订阅状态（#144）的双向同步。
 */

beforeEach(() => {
  loadSourceModes({});
  loadTier3State(undefined);
  useSettingsStore.setState({ sourceModes: {}, tier3Enabled: false, tier3Subscriptions: [] });
  vi.clearAllMocks();
});

describe('settingsStore ↔ core 来源开关双向同步', () => {
  it('core setSourceModes → persister 镜像进 store（持久化方向）', () => {
    setSourceModes({ netease: 'direct', qq: 'auto' });
    expect(useSettingsStore.getState().sourceModes).toEqual({ netease: 'direct', qq: 'auto' });
  });

  it('rehydrate 时回灌 core 路由（启动方向）', async () => {
    (AsyncStorage.getItem as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ state: { sourceModes: { qq: 'direct' } }, version: 0 }),
    );
    await useSettingsStore.persist.rehydrate();
    expect(getSourceMode('qq')).toBe('direct');
    expect(useSettingsStore.getState().sourceModes).toEqual({ qq: 'direct' });
  });

  it('rehydrate 存量 legacy "api" 洗白为 "auto" 并回写 store（#277）', async () => {
    (AsyncStorage.getItem as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ state: { sourceModes: { qq: 'api', netease: 'bogus' } }, version: 0 }),
    );
    await useSettingsStore.persist.rehydrate();
    // core 路由拿到洗白后的模式：api → auto，非法值过滤
    expect(getSourceMode('qq')).toBe('auto');
    expect(getSourceMode('netease')).toBe('auto');
    // store 状态同步洗白（回写触发 persist 落盘干净数据）
    expect(useSettingsStore.getState().sourceModes).toEqual({ qq: 'auto' });
  });
});

describe('settingsStore ↔ core tier3 订阅状态双向同步（#144）', () => {
  it('core setTier3Enabled → persister 镜像进 store（持久化方向）', () => {
    setTier3Enabled(true);
    expect(useSettingsStore.getState().tier3Enabled).toBe(true);
    expect(getTier3State().enabled).toBe(true);
  });

  it('rehydrate 时回灌 core tier3 状态（启动方向）', async () => {
    (AsyncStorage.getItem as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        state: { tier3Enabled: true, tier3Subscriptions: [{ id: 's1', name: 'Demo', kind: 'text', source: 'demo', manifest: { version: 1, sources: [] }, updatedAt: 0 }] },
        version: 0,
      }),
    );
    await useSettingsStore.persist.rehydrate();
    expect(getTier3State().enabled).toBe(true);
    expect(useSettingsStore.getState().tier3Subscriptions).toHaveLength(1);
  });
});
