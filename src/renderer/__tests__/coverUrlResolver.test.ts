import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/renderer/services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

import { IpcClient } from '@/renderer/services/IpcClient';
import { resolveCoverUrl, invalidateCoverUrl, __resetCoverUrlResolver } from '@/renderer/services/coverUrlResolver';

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
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'resolveCoverUrl', url);
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

  it('归一化 key：同资源不同签名命中同一缓存，不重复 IPC', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue('https://cdn.example.com/cover.jpg');
    const urlA = 'https://api.example.com/api.php?get=pic&id=3&sign=AAA&t=100';
    const urlB = 'https://api.example.com/api.php?get=pic&id=3&sign=BBB&t=200';

    expect(await resolveCoverUrl(urlA)).toBe('https://cdn.example.com/cover.jpg');
    expect(await resolveCoverUrl(urlB)).toBe('https://cdn.example.com/cover.jpg');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('invalidateCoverUrl 清除缓存（归一化 + 旧完整 URL 项），并通知主进程', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue('https://cdn.example.com/cover.jpg');
    const url = 'https://api.example.com/api.php?get=pic&id=4&sign=OLD&t=1';

    expect(await resolveCoverUrl(url)).toBe('https://cdn.example.com/cover.jpg');
    // 归一化 key 命中缓存，不再 IPC
    await resolveCoverUrl('https://api.example.com/api.php?get=pic&id=4&sign=NEW&t=2');
    expect(invoke).toHaveBeenCalledTimes(1);

    invalidateCoverUrl(url);
    // 失效后重新解析必须重新 IPC（缓存已清）
    await resolveCoverUrl(url);
    expect(invoke).toHaveBeenCalledWith('musicApi:call', 'invalidateCoverUrl', url);
    expect(invoke).toHaveBeenCalledWith('cache:invalidateCover', url);
    // 1 次解析 + 2 次失效通知 + 1 次重解析
    expect(invoke).toHaveBeenCalledTimes(4);
  });
});
