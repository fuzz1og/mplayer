import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { loadQueue, persistQueue } from '../utils/queueUtils';

const KEY = 'mplayer_queue';

function song(id: string): Song {
  return { id, name: id, artist: 'a', album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

const write = (payload: unknown) => localStorage.setItem(KEY, JSON.stringify(payload));

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// #511：队列持久化带上「洗牌序 + 游标」，重启后顺序不变
// ---------------------------------------------------------------------------
describe('队列持久化带稳定随机序列（#511）', () => {
  it('persist → load 往返保留顺序与游标（重启后顺序不变）', () => {
    const songs = [song('a'), song('b'), song('c'), song('d')];

    persistQueue(songs, 1, { order: ['d', 'b', 'a', 'c'], cursor: 1 });

    const restored = loadQueue();
    expect(restored.playlist.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(restored.index).toBe(1);
    expect(restored.shuffle).toEqual({ order: ['d', 'b', 'a', 'c'], cursor: 1 });
  });

  it('存量数据没有 shuffle → null（回落旧行为，不凭空造序列）', () => {
    write({ playlist: [song('a'), song('b')], index: 0 });

    expect(loadQueue().shuffle).toBeNull();
  });

  it('显式传 null = 没有序列（落盘 null，不会残留旧序列）', () => {
    persistQueue([song('a')], 0, null);

    expect(JSON.parse(localStorage.getItem(KEY) || '{}').shuffle).toBeNull();
  });

  it('形状损坏的 shuffle → 丢弃，不抛', () => {
    write({ playlist: [song('a'), song('b')], index: 0, shuffle: { order: 'nope', cursor: 0 } });
    expect(loadQueue().shuffle).toBeNull();

    write({ playlist: [song('a'), song('b')], index: 0, shuffle: { order: ['a', 7], cursor: 0 } });
    expect(loadQueue().shuffle).toBeNull();

    write({ playlist: [song('a'), song('b')], index: 0, shuffle: { order: [], cursor: 0 } });
    expect(loadQueue().shuffle).toBeNull();
  });

  it('序列含已不在队列的 id / 缺 id → 增量对齐成合法排列', () => {
    write({ playlist: [song('a'), song('b')], index: 0, shuffle: { order: ['b', 'zzz'], cursor: 0 } });

    // 丢掉 zzz、补上 a；游标对到当前曲 a（序列第 1 位）
    expect(loadQueue().shuffle).toEqual({ order: ['b', 'a'], cursor: 1 });
  });

  it('游标越界 → 对到当前曲，不抛', () => {
    write({ playlist: [song('a'), song('b')], index: 1, shuffle: { order: ['a', 'b'], cursor: 99 } });

    expect(loadQueue().shuffle).toEqual({ order: ['a', 'b'], cursor: 1 });
  });

  it('没有存档 / 空队列 → 序列为 null', () => {
    expect(loadQueue()).toEqual({ playlist: [], index: -1, shuffle: null });
    write({ playlist: [], index: -1, shuffle: { order: ['a'], cursor: 0 } });
    expect(loadQueue()).toEqual({ playlist: [], index: -1, shuffle: null });
  });
});
