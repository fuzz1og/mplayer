/**
 * Android 原生主引擎的「每源请求头」传递链（#592）。
 *
 * 链：`buildTrack` → `Track.headers` → `patchQueue`/`loadQueue` → （Kotlin）
 * `TrackInput.headers` → `TrackRecord` → `QueueStore` → `ExpiryGuard` → `DataSpec.withRequestHeaders`。
 * 本文件只断言 **JS 这一端交出去的头**（Kotlin 侧无测试框架，见 ADR
 * `2026-10-08-per-source-request-headers.md`；原生入参/注入是源码文本守卫 + 真机取证的活）。
 *
 * 全局 `__tests__/setup.ts` 已把 `expo` 的 `requireOptionalNativeModule` 打成 null；
 * `buildTrack` 不碰原生桥，所以这里不需要假原生模块。
 */
import { describe, expect, it, vi } from 'vitest';
import { BROWSER_UA } from '@mplayer/core';
import type { Song } from '@mplayer/core';

// 只验 buildTrack 的请求头拼装：解析链与缓存替身掉（node 环境里起不来）。
vi.mock('../services/cacheService', () => ({
  getCachedResource: async () => null,
  setCachedResource: async () => {},
  urlAgeMs: () => null,
}));
vi.mock('../services/songResolution', () => ({
  resolvePlayableUrlMobile: vi.fn(async () => ({ url: 'https://cdn.example.com/x.mp3', nonFull: false })),
}));

import { buildTrack } from '../services/nativePlayer';

function makeSong(sourceType: Song['sourceType']): Song {
  return {
    id: 's1',
    name: '测试曲',
    artist: '测试歌手',
    album: '测试专辑',
    duration: 200,
    sourceType,
    url: '',
    cover: '',
    lrc: '',
  };
}

const HTTP_URL = 'https://cdn.example.com/s1.mp3';

describe('buildTrack 的每源请求头（#592）', () => {
  it('按源带 UA + 官方站点 Referer（kugou/qq 等防盗链 CDN 必需）', () => {
    expect(buildTrack(makeSong('kugou'), HTTP_URL, false).headers).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://www.kugou.com/',
    });
    expect(buildTrack(makeSong('qq'), HTTP_URL, false).headers).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://y.qq.com/',
    });
    expect(buildTrack(makeSong('netease'), HTTP_URL, false).headers).toEqual({
      'User-Agent': BROWSER_UA,
      Referer: 'https://music.163.com/',
    });
  });

  it('未知源（如 soda）只带 UA，不带 Referer', () => {
    const headers = buildTrack(makeSong('soda'), HTTP_URL, false).headers;
    expect(headers?.['User-Agent']).toBe(BROWSER_UA);
    expect(headers).not.toHaveProperty('Referer');
  });

  it('local 源不带头（本地文件不发 HTTP，也没有可冒用的源域名）', () => {
    expect(buildTrack(makeSong('local'), 'file:///data/user/0/x/a.mp3', false).headers).toBeUndefined();
  });

  it('已下载歌曲回落到 file:// 直链时不带头（即使源不是 local）', () => {
    expect(buildTrack(makeSong('kugou'), 'file:///data/user/0/x/a.mp3', false).headers).toBeUndefined();
  });
});
