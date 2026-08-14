import { describe, expect, it } from 'vitest';
import { musicApi } from '../musicApi.js';
import type { Song } from '../../types/index.js';

function song(id: string, url = ''): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url, cover: '', lrc: '' };
}

describe('core musicApi 收编方法（ADR-0001）', () => {
  it('invalidateCoverUrl 已补进对象（一行）', () => {
    expect(typeof musicApi.invalidateCoverUrl).toBe('function');
  });

  it('probeSongsBatch 空 url → invalid（保持桌面现状）', async () => {
    const results = await musicApi.probeSongsBatch([song('1')]);
    // 空 url 那首必为 invalid 语义（不触发网络探测）
    expect(results).toHaveLength(1);
    expect(results[0].songId).toBe('1');
    expect(results[0].tag).toBe('invalid');
  });

  it('probeSongsBatch 空数组返回空', async () => {
    await expect(musicApi.probeSongsBatch([])).resolves.toEqual([]);
  });

  it('fillSongUrls 包装 resolveNeteaseSongUrlsBySearch 并返回数组', async () => {
    const s = song('1');
    const out = await musicApi.fillSongUrls([s], '专辑名');
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(typeof musicApi.resolveNeteaseSongUrlsBySearch).toBe('function');
  });
});
