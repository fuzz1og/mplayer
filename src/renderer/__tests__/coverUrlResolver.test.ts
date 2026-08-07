import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

import { IpcClient } from '@/renderer/services/IpcClient';
import { resolveCoverUrl, __resetCoverUrlResolver } from '@/renderer/services/coverUrlResolver';

describe('coverUrlResolver 封面直链解析', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCoverUrlResolver();
  });

  it('非会话保护 URL 原样返回，不发起 IPC', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    expect(await resolveCoverUrl('https://p1.music.126.net/cover.jpg')).toBe('https://p1.music.126.net/cover.jpg');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('api.php 封面解析成 CDN 直链，并发去重只请求一次', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue('https://cdn.example.com/cover.jpg');
    const url = 'https://api.example.com/api.php?get=pic&id=1&sign=s&t=1';

    const [a, b] = await Promise.all([resolveCoverUrl(url), resolveCoverUrl(url)]);

    expect(a).toBe('https://cdn.example.com/cover.jpg');
    expect(b).toBe(a);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('musicApi:resolveCoverUrl', url);
  });

  it('解析失败回退原 URL 且不缓存，下次可重试', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const url = 'https://api.example.com/api.php?get=pic&id=2&sign=s&t=1';
    invoke.mockRejectedValueOnce(new Error('会话不可用'));

    expect(await resolveCoverUrl(url)).toBe(url);

    invoke.mockResolvedValueOnce('https://cdn.example.com/cover2.jpg');
    expect(await resolveCoverUrl(url)).toBe('https://cdn.example.com/cover2.jpg');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
