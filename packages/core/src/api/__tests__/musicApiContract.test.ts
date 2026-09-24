import { describe, expect, it } from 'vitest';
import { musicApi } from '../musicApi.js';

/**
 * core musicApi 门面契约（ADR-0001）。
 * #391：批量探测（probeSongsBatch）已删除——判据反向且产物无消费者，
 * 其测试随之移除（预解析改由 prefetchPlayableSong 门面承担，见 musicApiPrefetch.test.ts）。
 */
describe('core musicApi 收编方法（ADR-0001）', () => {
  it('基础门面方法在门面上（BASE_METHODS 登记依赖这些方法存在）', () => {
    const methods = [
      'getLyrics',
      'getQqPlaylistSongs',
      'searchSongsRouted',
      'resolvePlayableUrlRouted',
      'resolvePlayableSongRouted',
      'prefetchPlayableSong',
      'forgetPrefetchedSong',
      'explainPlaybackFailure',
    ] as const;
    for (const m of methods) {
      expect(typeof (musicApi as Record<string, unknown>)[m]).toBe('function');
    }
  });
});

describe('musicApi 门面 QQ 歌单方法（#280，BASE_METHODS 契约同步）', () => {
  it('getQqPlaylistSongs 在门面上（BASE_METHODS 登记依赖此方法存在）', () => {
    expect(typeof musicApi.getQqPlaylistSongs).toBe('function');
  });
});
