import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';

describe('callMusicApi 泛型入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按 (musicApi:call, method, ...args) 分发调用', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue([{ id: '1', name: '晴天' }]);
    const data = await callMusicApi('searchSongsRouted', '晴天', 1, 'netease');
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongsRouted', '晴天', 1, 'netease');
    expect(data).toEqual([{ id: '1', name: '晴天' }]);
  });

  it('getThrottleWait 返回数值', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue(1500);
    const wait = await callMusicApi('getThrottleWait');
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'getThrottleWait');
    expect(wait).toBe(1500);
  });

  it('失败时 IpcClient 抛错则向上传播', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockRejectedValue(new Error('unknown musicApi method: xxx'));
    await expect(callMusicApi('getNeteaseHotlist' as any, {})).rejects.toThrow(
      'unknown musicApi method: xxx',
    );
  });
});
