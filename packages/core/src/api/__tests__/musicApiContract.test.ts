import { describe, expect, it, vi, beforeEach } from 'vitest';
import { musicApi } from '../musicApi.js';
import { registerDirectClient, clearDirectClients, setTier3Enabled, setTier3Resolver } from '../../shared/sourceRouter.js';
import type { Song } from '../../types/index.js';
import { clearPrefetchCache, getPrefetchedUrl } from '../prefetchCache.js';

// HTTP 探测是系统边界：mock 掉 probeAudioUrl，让探测批次在无网络下可控。
vi.mock('../audioProbe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audioProbe.js')>();
  return { ...actual, probeAudioUrl: vi.fn() };
});
import { probeAudioUrl } from '../audioProbe.js';

function song(id: string, url = ''): Song {
  return { id, name: '晴天', artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url, cover: '', lrc: '' };
}

beforeEach(() => {
  clearDirectClients();
  clearPrefetchCache();
  setTier3Enabled(false);
  setTier3Resolver(null);
  vi.mocked(probeAudioUrl).mockReset();
});

describe('core musicApi 收编方法（ADR-0001）', () => {
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

  it('probeSongsBatch 把直连解析结果写入预取缓存（preview → nonFull=true）', async () => {
    vi.mocked(probeAudioUrl).mockResolvedValue('preview');
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://cdn.example.com/a.mp3'),
    });

    const results = await musicApi.probeSongsBatch([song('1')]);

    expect(results[0]).toEqual({ songId: '1', tag: 'preview' });
    expect(getPrefetchedUrl(song('1'))).toEqual({
      url: 'https://cdn.example.com/a.mp3',
      nonFull: true,
    });
  });

  it('probeSongsBatch 探测 invalid 不写预取缓存（直连死链）', async () => {
    vi.mocked(probeAudioUrl).mockResolvedValue('invalid');
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => 'https://cdn.example.com/dead.mp3'),
    });

    await musicApi.probeSongsBatch([song('1')]);

    expect(getPrefetchedUrl(song('1'))).toBeUndefined();
  });

  it('probeSongsBatch 无 URL（直连无版权）不写预取缓存', async () => {
    registerDirectClient({
      key: 'netease',
      resolvePlayableUrl: vi.fn(async () => ''),
    });

    await musicApi.probeSongsBatch([song('1')]);

    expect(getPrefetchedUrl(song('1'))).toBeUndefined();
  });
});
