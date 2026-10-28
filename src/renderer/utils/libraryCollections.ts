import type { Album, Artist, Song } from '@mplayer/core';

/**
 * 内容库三视角（#694）：歌曲 / 专辑 / 歌手是同一批数据的三种聚合。
 * Song 不带源专辑/歌手 id，聚合只按名称归类，重名不同源在此合并——内容库视图不跨源区分。
 */
export interface AlbumCollection {
  id: string;
  name: string;
  artist: string;
  cover: string;
  album: Album;
  songs: Song[];
}

export interface ArtistCollection {
  id: string;
  name: string;
  artist: Artist;
  songs: Song[];
}

const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' });

const cleanName = (value: string | undefined): string => (value ?? '').trim();

export function collectAlbums(songs: Song[]): AlbumCollection[] {
  const groups = new Map<string, AlbumCollection>();

  for (const song of songs) {
    const name = cleanName(song.album);
    if (!name) continue;
    const cover = song.cover || '';
    const existing = groups.get(name);
    if (existing) {
      existing.songs.push(song);
      if (!existing.cover && cover) {
        existing.cover = cover;
        existing.album.picUrl = cover;
      }
      continue;
    }
    groups.set(name, {
      id: 'library-album:' + name,
      name,
      artist: cleanName(song.artist),
      cover,
      album: {
        id: 'library-album:' + name,
        name,
        picUrl: cover,
        artist: cleanName(song.artist),
        publishTime: '',
        sourceType: song.sourceType,
      },
      songs: [song],
    });
  }

  return Array.from(groups.values()).sort((a, b) => collator.compare(a.name, b.name));
}

export function collectArtists(songs: Song[]): ArtistCollection[] {
  const groups = new Map<string, ArtistCollection>();
  const albumNames = new Map<string, Set<string>>();

  for (const song of songs) {
    const name = cleanName(song.artist);
    if (!name) continue;
    const albumName = cleanName(song.album);
    const existing = groups.get(name);
    if (existing) {
      existing.songs.push(song);
      if (albumName) albumNames.get(name)?.add(albumName);
      continue;
    }
    groups.set(name, {
      id: 'library-artist:' + name,
      name,
      artist: {
        id: 'library-artist:' + name,
        name,
        picUrl: '',
        alias: [],
        albumSize: 0,
        musicSize: 0,
        sourceType: song.sourceType,
      },
      songs: [song],
    });
    albumNames.set(name, new Set(albumName ? [albumName] : []));
  }

  for (const group of groups.values()) {
    group.artist.albumSize = albumNames.get(group.name)?.size ?? 0;
    group.artist.musicSize = group.songs.length;
  }

  return Array.from(groups.values()).sort((a, b) => collator.compare(a.name, b.name));
}
