import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Song } from '@mplayer/core';

interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
}

interface PlaylistStore {
  playlists: Playlist[];
  createPlaylist: (name: string) => void;
  deletePlaylist: (id: string) => void;
  addSong: (playlistId: string, song: Song) => void;
  removeSong: (playlistId: string, songId: string) => void;
  renamePlaylist: (id: string, name: string) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const usePlaylistStore = create<PlaylistStore>()(
  persist(
    (set) => ({
      playlists: [],

      createPlaylist: (name) =>
        set((state) => ({
          playlists: [
            ...state.playlists,
            { id: generateId(), name, songs: [], createdAt: Date.now() },
          ],
        })),

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
                  songs: p.songs.some((s) => s.id === song.id)
                    ? p.songs
                    : [...p.songs, song],
                }
              : p,
          ),
        })),

      removeSong: (playlistId, songId) =>
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, songs: p.songs.filter((s) => s.id !== songId) }
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
