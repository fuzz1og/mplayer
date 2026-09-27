import { describe, expect, it } from 'vitest';
import type { Album } from '@mplayer/core';
import {
  ALBUM_TIMELINE_COLS,
  UNKNOWN_YEAR,
  albumYear,
  buildAlbumTimeline,
  groupAlbumsByYear,
} from '../components/albumTimeline';

/** 期望值一律写字面量；时间戳取各源真实形状（epoch ms 字符串）。 */
const album = (id: string, publishTime: string, name = `专辑${id}`): Album => ({
  id,
  name,
  picUrl: '',
  artist: '歌手',
  publishTime,
  sourceType: 'netease',
});

/** 1997-12-05 / 2002-08-08 / 2025-04-14（UTC 零点，见 core utils/publishTime 的口径） */
const Y1997 = '881280000000';
const Y2002 = '1028736000000';
const Y2025 = '1744588800000';

describe('歌手专辑时间线（#417 P0.1）', () => {
  it('albumYear：从 epoch ms 字符串取年份；取不到给空串', () => {
    expect(albumYear(album('1', Y1997))).toBe('1997');
    expect(albumYear(album('2', Y2025))).toBe('2025');
    expect(albumYear(album('3', ''))).toBe('');
    expect(albumYear(album('4', 'abc'))).toBe('');
    expect(albumYear(album('5', '0'))).toBe('');
  });

  it('按年份降序分组；组内按发行时间降序', () => {
    const groups = groupAlbumsByYear([album('a', Y1997), album('b', Y2025), album('c', Y2002)]);
    expect(groups.map((g) => g.year)).toEqual(['2025', '2002', '1997']);
    const twoIn2013a = groupAlbumsByYear([album('x', '1356969600000'), album('y', '1375315200000')]);
    expect(twoIn2013a[0].albums.map((s) => s.id)).toEqual(['y', 'x']);
  });

  it('无发行时间的归「未知年份」且恒排最后', () => {
    const groups = groupAlbumsByYear([album('a', ''), album('b', Y2025), album('c', 'abc')]);
    expect(groups.map((g) => g.year)).toEqual(['2025', UNKNOWN_YEAR]);
    expect(groups[1].albums.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('展平为「年份头 + 每 3 张一行」，行内不跨年', () => {
    const albums = [
      album('1', Y2025), album('2', Y2025), album('3', Y2025), album('4', Y2025),
      album('5', Y1997),
    ];
    const items = buildAlbumTimeline(albums);
    expect(ALBUM_TIMELINE_COLS).toBe(3);
    expect(items.map((i) => i.kind)).toEqual(['year', 'row', 'row', 'year', 'row']);
    expect(items[0]).toMatchObject({ kind: 'year', year: '2025', count: 4 });
    expect((items[1] as { albums: Album[] }).albums.map((a) => a.id)).toEqual(['1', '2', '3']);
    expect((items[2] as { albums: Album[] }).albums.map((a) => a.id)).toEqual(['4']);
    expect(items[3]).toMatchObject({ kind: 'year', year: '1997', count: 1 });
  });

  it('空列表 → 空时间线（页面据此走空态，而不是渲染一个孤零零的年份头）', () => {
    expect(buildAlbumTimeline([])).toEqual([]);
  });

  it('列数可覆盖且非法值兜底为 1（不产生空行）', () => {
    const albums = [album('1', Y2025), album('2', Y2025)];
    const two = buildAlbumTimeline(albums, 2).filter((i) => i.kind === 'row');
    expect(two).toHaveLength(1);
    expect((two[0] as { albums: Album[] }).albums).toHaveLength(2);
    const one = buildAlbumTimeline(albums, 0).filter((i) => i.kind === 'row');
    expect(one).toHaveLength(2);
  });
});
