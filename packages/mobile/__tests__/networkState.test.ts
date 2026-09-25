import { beforeEach, describe, expect, it, vi } from 'vitest';

const netinfo = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: netinfo.fetch },
}));

import { isOffline } from '../services/networkState';

describe('networkState.isOffline（#385 离线判定归一化）', () => {
  beforeEach(() => {
    netinfo.fetch.mockReset();
  });

  it('isConnected === false → 离线', async () => {
    netinfo.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: null });
    expect(await isOffline()).toBe(true);
  });

  it('isInternetReachable === false → 离线（连着但不可达）', async () => {
    netinfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: false });
    expect(await isOffline()).toBe(true);
  });

  it('未知态（null/null）→ 不判离线', async () => {
    netinfo.fetch.mockResolvedValue({ isConnected: null, isInternetReachable: null });
    expect(await isOffline()).toBe(false);
  });

  it('在线 → 不判离线', async () => {
    netinfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    expect(await isOffline()).toBe(false);
  });

  it('fetch 抛错（原生模块不可用）→ 不判离线，避免误报断网', async () => {
    netinfo.fetch.mockRejectedValue(new Error('native module missing'));
    expect(await isOffline()).toBe(false);
  });
});
