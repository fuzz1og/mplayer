export interface SongBase {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  sourceType: 'netease' | 'qq';
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
