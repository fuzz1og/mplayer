export interface SongBase {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  sourceType: 'netease' | 'qq' | 'kugou' | 'migu' | 'kuwo' | 'qianqian' | 'soda' | 'local';
}

export interface Song extends SongBase {
  url: string;
  cover: string;
  lrc: string;
}

export interface SearchResult {
  data: Song[];
}

export interface Favorite {
  id?: number;
  songId: string;
  song: SongBase;
  createdAt: Date;
}

export interface PlayHistory {
  id?: number;
  songId: string;
  song: SongBase;
  playedAt: Date;
}

export interface Playlist {
  id: number;
  name: string;
  description?: string;
  createdAt: Date;
}

export interface PlaylistSong {
  id?: number;
  playlistId: number;
  songId: string;
  order: number;
  song: Song;
}

export interface LocalFolder {
  path: string;
  name: string;
  songCount: number;
  lastScanned: Date;
}

export interface Artist {
  id: string;
  name: string;
  picUrl: string;
  alias: string[];
  trans?: string;
  albumSize: number;
  musicSize: number;
  sourceType: string;
}

export interface LocalSong {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  sourceType: 'local';
  filePath: string;
  coverBase64?: string;
  format: string;
  fileSize: number;
}

export interface SongGroup {
  key: string;
  name: string;
  artist: string;
  songs: Song[];
}

export interface DiscoverPlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  playCount: number;
  trackCount: number;
  creator: { nickname: string };
  tags: string[];
  description: string;
}
