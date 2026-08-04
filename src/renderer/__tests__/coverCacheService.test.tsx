import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

import { IpcClient } from '../services/IpcClient';
import { cacheCoverImage, useCachedCover } from '../services/coverCacheService';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const COVER_URL = 'https://example.com/cover.jpg';

function okImageResponse(): Response {
  return { ok: true, arrayBuffer: async () => PNG_BYTES.buffer } as unknown as Response;
}

function okHtmlResponse(): Response {
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode('<html>default</html>').buffer } as unknown as Response;
}

describe('coverCacheService 封面缓存', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('下载成功且内容是真实图片时才写入缓存', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    invoke.mockResolvedValue(undefined);
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(okImageResponse());

    await cacheCoverImage(COVER_URL);
    expect(invoke).toHaveBeenCalledWith('cache:setCover', COVER_URL, expect.any(Buffer));
  });

  it('非图片响应（默认图/错误页/反爬页）绝不写入缓存', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(okHtmlResponse());

    await cacheCoverImage(COVER_URL);
    expect(invoke).not.toHaveBeenCalledWith('cache:setCover', expect.any(String), expect.any(Buffer));
  });

  it('HTTP 失败静默，不写入缓存', async () => {
    const invoke = vi.mocked(IpcClient.invoke);
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockRejectedValue(new Error('网络错误'));

    await cacheCoverImage(COVER_URL);
    expect(invoke).not.toHaveBeenCalledWith('cache:setCover', expect.any(String), expect.any(Buffer));
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
    const fetchMock = vi.mocked(global.fetch);
    await cacheCoverImage('file://C:/x.jpg');
    await cacheCoverImage('data:image/png;base64,xxx');
    await cacheCoverImage('not-a-url');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
