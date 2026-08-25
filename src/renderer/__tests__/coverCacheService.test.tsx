import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

import { IpcClient } from '../services/IpcClient';
import { cacheCoverImage, useCachedCover } from '../services/coverCacheService';

const COVER_URL = 'https://example.com/cover.jpg';

describe('coverCacheService 封面缓存', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('下载委托主进程（webSecurity 恢复后渲染层跨域 fetch 受 CORS 限制）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue(undefined);

    await cacheCoverImage(COVER_URL);
    expect(invoke).toHaveBeenCalledWith('cache:downloadCover', COVER_URL);
  });

  it('主进程下载失败静默（字节校验与拒绝在语义层 setCoverBytes，渲染层不抛）', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockRejectedValue(new Error('下载失败'));

    await expect(cacheCoverImage(COVER_URL)).resolves.toBeUndefined();
  });

  it('受保护封面端点（需会话 cookie）不发起下载——落盘缓存改由主进程解析时完成', async () => {
    const invoke = vi.mocked(IpcClient.invoke);

    await cacheCoverImage('https://api.example.com/api.php?get=pic&type=wy&id=1&sign=s&t=1');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('useCachedCover 命中缓存返回 file://，未命中返回远程地址', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValueOnce('C:\\cache\\bin\\abc123');

    const Tester = ({ url }: { url: string }) => {
      const src = useCachedCover(url);
      return <span data-testid="cover-src">{src}</span>;
    };

    const { getByTestId, rerender } = render(<Tester url={COVER_URL} />);
    await act(async () => { await Promise.resolve(); });
    expect(getByTestId('cover-src').textContent).toBe('file://C:\\cache\\bin\\abc123');

    // coverUrl 变化（封面刷新换新 URL）→ 重新解析
    invoke.mockResolvedValueOnce(null);
    rerender(<Tester url="https://example.com/new-cover.jpg" />);
    await act(async () => { await Promise.resolve(); });
    expect(getByTestId('cover-src').textContent).toBe('https://example.com/new-cover.jpg');
  });

  it('非 http(s) 或 file:// 地址不触发下载', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    await cacheCoverImage('file://C:/x.jpg');
    await cacheCoverImage('data:image/png;base64,xxx');
    await cacheCoverImage('not-a-url');
    expect(invoke).not.toHaveBeenCalled();
  });
});
