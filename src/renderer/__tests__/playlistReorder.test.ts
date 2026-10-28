import { describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { reorderVisibleSongs } from '@/renderer/utils/playlistReorder';

const song = (i: number) => ({ id: 's' + i, name: '曲目 ' + i, sourceType: 'netease' } as Song);
const LIST = (n: number) => Array.from({ length: n }, (_, i) => song(i));
const ids = (songs: Song[]) => songs.map((s) => s.id);

describe('过滤态拖拽映射（#703）', () => {
  it('只重排可见集合，不可见歌曲的位置与相对顺序不动', () => {
    const all = LIST(6);
    const visible = [all[1], all[3], all[5]];
    const next = reorderVisibleSongs(all, visible, 0, 2);
    expect(ids(next)).toEqual(['s0', 's3', 's2', 's5', 's4', 's1']);
  });

  it('可见集合内前移同样只换可见位的值', () => {
    const all = LIST(5);
    const visible = [all[0], all[2], all[4]];
    const next = reorderVisibleSongs(all, visible, 2, 0);
    expect(ids(next)).toEqual(['s4', 's1', 's0', 's3', 's2']);
  });

  it('同下标是 no-op，且不修改入参', () => {
    const all = LIST(4);
    const visible = [all[2]];
    const next = reorderVisibleSongs(all, visible, 0, 0);
    expect(next).toBe(all);
    expect(ids(all)).toEqual(['s0', 's1', 's2', 's3']);
  });
});
