import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import axios from 'axios';
import { resolvePlaylistLink } from '../../main/services/playlistLinkResolver';

const mockedGet = vi.mocked(axios.get);

/** 构造一个 axios 响应形参（resolver 只读 status / headers） */
function resp(status: number, location?: string) {
  return { status, headers: location ? { location } : {} };
}

describe('resolvePlaylistLink（歌单短链 302 跟随）', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('逐跳跟随 3xx Location，返回最终落地 URL', async () => {
    mockedGet
      .mockResolvedValueOnce(resp(302, 'https://music.163.com/playlist?id=123456&userid=9'))
      .mockResolvedValueOnce(resp(200));

    const final = await resolvePlaylistLink('https://163cn.tv/abc123');

    expect(final).toBe('https://music.163.com/playlist?id=123456&userid=9');
    expect(mockedGet).toHaveBeenCalledTimes(2);
    // 关闭自动重定向：axios 只拿 headers 自行跟跳
    expect(mockedGet.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
  });

  it('相对 Location 按当前 URL 解析', async () => {
    mockedGet
      .mockResolvedValueOnce(resp(302, 'https://music.163.com/outchain'))
      .mockResolvedValueOnce(resp(302, '/playlist?id=42'))
      .mockResolvedValueOnce(resp(200));

    const final = await resolvePlaylistLink('https://163cn.tv/x');

    expect(final).toBe('https://music.163.com/playlist?id=42');
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it('无重定向直接返回原 URL', async () => {
    mockedGet.mockResolvedValueOnce(resp(200));

    const final = await resolvePlaylistLink('https://music.163.com/playlist?id=7');

    expect(final).toBe('https://music.163.com/playlist?id=7');
  });

  it('拒绝白名单外的域名', async () => {
    await expect(resolvePlaylistLink('https://evil.example.com/redirect')).rejects.toThrow('不支持的歌单链接域名');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('重定向次数超限抛错', async () => {
    mockedGet.mockImplementation(async () => resp(302, 'https://163cn.tv/next'));

    await expect(resolvePlaylistLink('https://163cn.tv/loop')).rejects.toThrow('重定向次数过多');
  });

  it('请求失败时上抛错误', async () => {
    mockedGet.mockRejectedValueOnce(new Error('网络错误'));

    await expect(resolvePlaylistLink('https://163cn.tv/abc')).rejects.toThrow('网络错误');
  });
});
