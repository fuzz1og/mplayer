import { describe, expect, it, vi, beforeEach } from 'vitest';
import { musicApi } from '../musicApi.js';
import { registerDirectClient, clearDirectClients, setTier3Enabled, setTier3Resolver } from '../../shared/sourceRouter.js';
import type { Song } from '../../types/index.js';

function song(id: string, url = ''): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url, cover: '', lrc: '' };
}

beforeEach(() => {
  clearDirectClients();
  setTier3Enabled(false);
  setTier3Resolver(null);
});

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

  it('probeSongsBatch 只走直连，不触发 tier3（探测=直连可播性，避免被慢源拖死）', async () => {
    const tier3 = vi.fn(async () => 'https://tier3.example.com/x.mp3');
    setTier3Enabled(true);
    setTier3Resolver(tier3);
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''), // 直连无版权 → 空
    });
    const results = await musicApi.probeSongsBatch([song('1')]);
    expect(results[0].tag).toBe('invalid');
    expect(tier3).not.toHaveBeenCalled();
  });

  it('fillSongUrls 包装 resolveNeteaseSongUrlsBySearch 并返回数组', async () => {
    const s = song('1');
    const out = await musicApi.fillSongUrls([s], '专辑名');
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(typeof musicApi.resolveNeteaseSongUrlsBySearch).toBe('function');
  });
});
