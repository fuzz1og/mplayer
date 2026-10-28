import { describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { collectAlbums, collectArtists } from '@/renderer/utils/libraryCollections';

const song = (id: string, name: string, artist: string, album: string, cover = ''): Song => ({
  id,
  name,
  artist,
  album,
  duration: 200,
  sourceType: 'netease',
  url: '',
  cover,
  lrc: '',
});

describe('内容库聚合（#694）', () => {
  it('专辑按 album 名聚合，同一专辑的多首歌归一组并保留组内顺序', () => {
    const songs = [
      song('1', 'A1', '歌手甲', '专辑乙', 'cover-b'),
      song('2', 'A2', '歌手甲', '专辑甲', 'cover-a'),
      song('3', 'A3', '歌手甲', '专辑乙', ''),
    ];
    const albums = collectAlbums(songs);
    expect(albums.map((group) => group.name)).toEqual(['专辑甲', '专辑乙']);
    const yi = albums.find((group) => group.name === '专辑乙')!;
    expect(yi.songs.map((item) => item.id)).toEqual(['1', '3']);
    expect(yi.artist).toBe('歌手甲');
    expect(yi.album.picUrl).toBe('cover-b');
    expect(yi.album.sourceType).toBe('netease');
  });

  it('专辑名或歌手名为空的行不参与聚合', () => {
    const songs = [song('1', 'A', '', '专辑甲'), song('2', 'B', '歌手乙', '  '), song('3', 'C', '歌手丙', '专辑丙')];
    expect(new Set(collectAlbums(songs).map((group) => group.name))).toEqual(new Set(['专辑甲', '专辑丙']));
    expect(new Set(collectArtists(songs).map((group) => group.name))).toEqual(new Set(['歌手乙', '歌手丙']));
  });

  it('歌手按 artist 聚合，albumCount 是该歌手在这批歌里的专辑数', () => {
    const songs = [
      song('1', 'A', '歌手甲', '专辑一'),
      song('2', 'B', '歌手甲', '专辑二'),
      song('3', 'C', '歌手甲', '专辑一'),
      song('4', 'D', '歌手乙', '专辑三'),
    ];
    const artists = collectArtists(songs);
    const first = artists.find((group) => group.name === '歌手甲')!;
    expect(first.songs.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(first.artist.albumSize).toBe(2);
    expect(first.artist.musicSize).toBe(3);
    const second = artists.find((group) => group.name === '歌手乙')!;
    expect(second.artist.albumSize).toBe(1);
  });

  it('聚合结果按名称本地化排序，大小写/全角不敏感', () => {
    const albums = collectAlbums([song('1', 'A', 's', 'b'), song('2', 'B', 's', 'A'), song('3', 'C', 's', 'c')]);
    expect(albums.map((group) => group.name)).toEqual(['A', 'b', 'c']);
  });
});
