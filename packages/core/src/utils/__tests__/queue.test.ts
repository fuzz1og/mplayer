import { describe, expect, it } from 'vitest';
import { getNextSongIndex, getPrevSongIndex } from '../queue.js';
import type { Song } from '../../types/index.js';

function song(id: string): Song {
  return { id, name: id, artist: 'a', album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

const queue = [song('1'), song('2'), song('3')];

describe('getNextSongIndex', () => {
  it('returns -1 for an empty queue', () => {
    expect(getNextSongIndex([], 0, '列表循环')).toBe(-1);
  });

  it('returns -1 when currentIndex is out of range', () => {
    expect(getNextSongIndex(queue, 3, '列表循环')).toBe(-1);
    expect(getNextSongIndex(queue, -1, '列表循环')).toBe(-1);
  });

  it('single loop: repeats the same index', () => {
    expect(getNextSongIndex(queue, 1, '单曲循环')).toBe(1);
  });

  it('list loop: wraps around to the first track', () => {
    expect(getNextSongIndex(queue, 2, '列表循环')).toBe(0);
    expect(getNextSongIndex(queue, 0, '列表循环')).toBe(1);
  });

  it('shuffle: never returns the current index (with a single song it does)', () => {
    for (let i = 0; i < 50; i++) {
      const next = getNextSongIndex(queue, 1, '随机播放');
      expect(next).not.toBe(1);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(3);
    }
    expect(getNextSongIndex([song('1')], 0, '随机播放')).toBe(0);
  });
});

describe('getPrevSongIndex', () => {
  it('returns -1 for an empty queue', () => {
    expect(getPrevSongIndex([], 0, '列表循环')).toBe(-1);
  });

  it('returns -1 when currentIndex is out of range', () => {
    expect(getPrevSongIndex(queue, 3, '列表循环')).toBe(-1);
    expect(getPrevSongIndex(queue, -1, '列表循环')).toBe(-1);
  });

  it('list loop: wraps backwards to the last track', () => {
    expect(getPrevSongIndex(queue, 0, '列表循环')).toBe(2);
    expect(getPrevSongIndex(queue, 2, '列表循环')).toBe(1);
  });

  it('single loop: still goes to previous track (preserved behavior, no replay)', () => {
    expect(getPrevSongIndex(queue, 1, '单曲循环')).toBe(0);
    expect(getPrevSongIndex(queue, 0, '单曲循环')).toBe(2);
  });

  it('shuffle: never returns the current index (with a single song it does)', () => {
    for (let i = 0; i < 50; i++) {
      const prev = getPrevSongIndex(queue, 1, '随机播放');
      expect(prev).not.toBe(1);
      expect(prev).toBeGreaterThanOrEqual(0);
      expect(prev).toBeLessThan(3);
    }
    expect(getPrevSongIndex([song('1')], 0, '随机播放')).toBe(0);
  });
});
