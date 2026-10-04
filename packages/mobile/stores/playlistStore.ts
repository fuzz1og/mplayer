import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { identityKey } from '@mplayer/core';
import type { Song } from '@mplayer/core';

interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
}

interface PlaylistStore {
  playlists: Playlist[];
  /** 新建歌单并返回新歌单 id（调用方要「新建后立即写入」时必须拿到 id） */
  createPlaylist: (name: string) => string;
  deletePlaylist: (id: string) => void;
  /**
   * 单曲加入。去重判据 = core **歌曲身份键**（源 + 去源前缀真实 ID，ADR-0012）；
   * 裸 id 与 `${source}:${rawId}` 收敛为同一首（#553）。
   */
  addSong: (playlistId: string, song: Song) => void;
  /**
   * 批量加入：一次 set = 一次持久化 + 一次渲染（导入长歌单用；逐首 addSong 是 O(N²)）。
   * 去重判据同上（core `identityKey`），**不再用裸 `Song.id`**——
   * 跨源同 id 曾被静默当成同一首丢掉（#553）。
   * 返回**真实新增条数**（去重后实际 append 的条数；批内重复与已存在的不计，#559）。
   */
  addSongs: (playlistId: string, songs: Song[]) => number;
  removeSong: (playlistId: string, songId: string) => void;
  /**
   * 批量移除：一次 set = 一次持久化 + 一次渲染（批量操作条用）。
   * songIds 按集合语义处理（重复无副作用）；空数组不做无谓 set；
   * 其余歌保持原有相对顺序。
   */
  removeSongs: (playlistId: string, songIds: string[]) => void;
  replaceSong: (playlistId: string, oldSongId: string, newSong: Song) => void;
  renamePlaylist: (id: string, name: string) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const usePlaylistStore = create<PlaylistStore>()(
  persist(
    (set) => ({
      playlists: [],

      createPlaylist: (name) => {
        const id = generateId();
        set((state) => ({
          playlists: [
            ...state.playlists,
            { id, name, songs: [], createdAt: Date.now() },
          ],
        }));
        return id;
      },

      deletePlaylist: (id) =>
        set((state) => ({
          playlists: state.playlists.filter((p) => p.id !== id),
        })),

      addSong: (playlistId, song) =>
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId
              ? {
                  ...p,
                  songs: p.songs.some((s) => identityKey(s) === identityKey(song))
                    ? p.songs
                    : [...p.songs, song],
                }
              : p,
          ),
        })),

      addSongs: (playlistId, songs) => {
        // #559：真实新增数在 updater 里数出来。zustand 的 set 同步跑完 updater，所以
        // set 返回后即可读；persist 的落盘是它自己的后续动作，不 await（内存先行）。
        let added = 0;
        set((state) => ({
          playlists: state.playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const have = new Set(p.songs.map((s) => identityKey(s)));
            // 边判定边把身份键并入 have：批内重复只收第一条（旧写法只建一次 have 不复用，
            // 批内重复会被双双 append，返回的条数也就不可信）。
            const fresh: Song[] = [];
            for (const s of songs) {
              const key = identityKey(s);
              if (have.has(key)) continue;
              have.add(key);
              fresh.push(s);
            }
            added = fresh.length;
            return fresh.length === 0 ? p : { ...p, songs: [...p.songs, ...fresh] };
          }),
        }));
        return added;
      },

      removeSong: (playlistId, songId) =>
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, songs: p.songs.filter((s) => s.id !== songId) }
              : p,
          ),
        })),

      removeSongs: (playlistId, songIds) => {
        if (songIds.length === 0) return;
        const drop = new Set(songIds);
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, songs: p.songs.filter((s) => !drop.has(s.id)) }
              : p,
          ),
        }));
      },

      // 歌单内替换一首（单曲换源持久化：原位换掉旧歌，保持顺序）
      replaceSong: (playlistId, oldSongId, newSong) =>
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, songs: p.songs.map((s) => (s.id === oldSongId ? newSong : s)) }
              : p,
          ),
        })),

      renamePlaylist: (id, name) =>
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        })),
    }),
    {
      name: 'mplayer-playlists',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export type { Playlist };
