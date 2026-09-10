import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

// expo-file-system 打桩：内存 Map 充当 L2 文件后端（node 环境无原生模块），
// 走真实 CacheKernel + MobileFileBackend 验证持久化往返。
const fsMocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    cacheDirectory: 'file:///cache',
    readAsStringAsync: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('ENOENT');
      return value;
    },
    writeAsStringAsync: async (path: string, data: string) => {
      files.set(path, data);
    },
    makeDirectoryAsync: async () => {},
    deleteAsync: async (path: string) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(path)) files.delete(key);
      }
    },
    readDirectoryAsync: async () => [] as string[],
    getInfoAsync: async () => ({ exists: false }),
  };
});

vi.mock('expo-file-system/legacy', () => fsMocks);

import { identityKey } from '@mplayer/core';
import {
  cacheKernel,
  deleteCachedResource,
  getCachedResource,
  setCachedResource,
  songResources,
  urlAgeMs,
} from '../services/cacheService';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: '123',
    name: '晴天',
    artist: '周杰伦',
    album: '',
    url: '',
    cover: '',
    lrc: '',
    duration: 240,
    sourceType: 'netease',
    ...overrides,
  };
}

const URL_A = 'https://cdn.example.com/a.mp3';

beforeEach(async () => {
  fsMocks.files.clear();
  await cacheKernel.clear();
});

describe('cacheService（移动端可播资源值缓存）', () => {
  it('资源值往返：url + nonFull + ts 原样持久化（L2 文件 JSON）', async () => {
    await setCachedResource(song(), { url: URL_A, nonFull: true, ts: 111 });

    await expect(getCachedResource(song())).resolves.toEqual({ url: URL_A, nonFull: true, ts: 111 });
  });

  it('键 = 身份键：裸 id 与换源后的带前缀 id 命中共一条目', async () => {
    await setCachedResource(song({ id: '123', sourceType: 'netease' }), {
      url: URL_A,
      nonFull: false,
      ts: 1,
    });

    await expect(getCachedResource(song({ id: 'netease:123', sourceType: 'netease' }))).resolves.toMatchObject({
      url: URL_A,
    });
  });

  it('键 = 身份键：同一 rawId 不同源不串（netease:123 ≠ qq:123）', async () => {
    await setCachedResource(song({ id: '123', sourceType: 'netease' }), {
      url: URL_A,
      nonFull: false,
      ts: 1,
    });

    await expect(getCachedResource(song({ id: '123', sourceType: 'qq' }))).resolves.toBeNull();
  });

  it('键 = 身份键：多层嵌套前缀折叠到最外层源', async () => {
    await setCachedResource(song({ id: 'kuwo:kugou:9', sourceType: 'kugou' }), {
      url: URL_A,
      nonFull: false,
      ts: 1,
    });

    await expect(getCachedResource(song({ id: 'kuwo:9', sourceType: 'kuwo' }))).resolves.toMatchObject({
      url: URL_A,
    });
  });

  it('旧版纯字符串条目归一为 { url, nonFull:false, ts:0 }（老用户缓存不失效）', async () => {
    await cacheKernel.setJSON(songResources.songKey(identityKey(song())), URL_A, 60_000);

    await expect(getCachedResource(song())).resolves.toEqual({ url: URL_A, nonFull: false, ts: 0 });
  });

  it('旧版三件套 { url, cover, lrc } 归一（补 nonFull:false / ts:0）', async () => {
    await cacheKernel.setJSON(
      songResources.songKey(identityKey(song())),
      { url: URL_A, cover: '', lrc: '' },
      60_000,
    );

    await expect(getCachedResource(song())).resolves.toEqual({ url: URL_A, nonFull: false, ts: 0 });
  });

  it('非 http 的历史条目按未命中处理（重新解析）', async () => {
    await cacheKernel.setJSON(songResources.songKey(identityKey(song())), 'undefined', 60_000);

    await expect(getCachedResource(song())).resolves.toBeNull();
  });

  it('无 id 的歌不读不写', async () => {
    await setCachedResource(song({ id: '' }), { url: URL_A, nonFull: false, ts: 1 });

    await expect(getCachedResource(song({ id: '' }))).resolves.toBeNull();
  });

  it('urlAgeMs：未写入 null；写入后为当前年龄；失效后回到 null', async () => {
    // 年龄表是模块级内存状态（不随 kernel.clear 清空）：用独立身份键从"未写入"开始
    const target = song({ id: 'age-check' });
    expect(urlAgeMs(target)).toBeNull();

    await setCachedResource(target, { url: URL_A, nonFull: false, ts: Date.now() - 5000 });
    const age = urlAgeMs(target);
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(5000);

    await deleteCachedResource(target);
    expect(urlAgeMs(target)).toBeNull();
    await expect(getCachedResource(target)).resolves.toBeNull();
  });

  it('ts=0（旧条目归一）写入时补当前时间，条目不再被当成 1970 年', async () => {
    await setCachedResource(song(), { url: URL_A, nonFull: false, ts: 0 });

    const stored = await getCachedResource(song());
    expect(stored?.ts).toBeGreaterThan(0);
  });
});
