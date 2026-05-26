import { create } from 'zustand';
import type { LocalFolder, LocalSong, Song } from '@/shared/types/song';
import { IpcClient } from '@/renderer/services/IpcClient';

const { ipcRenderer } = window.require('electron');

interface LocalStoreState {
  folders: LocalFolder[];
  songs: Song[];
  currentFolder: string | null;
  isScanning: boolean;
  scanProgress: { current: number; total: number } | null;
  initialized: boolean;
}

interface LocalStoreActions {
  initialize: () => Promise<void>;
  addFolder: () => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  setCurrentFolder: (path: string | null) => void;
  handleFolderChange: (payload: { type: 'add' | 'remove'; folderPath: string; songs?: LocalSong[]; songIds?: string[] }) => void;
}

export type LocalStore = LocalStoreState & LocalStoreActions;

const localSongToSong = (localSong: LocalSong): Song => ({
  id: localSong.id,
  name: localSong.name,
  artist: localSong.artist,
  album: localSong.album,
  duration: localSong.duration,
  sourceType: 'local',
  url: `file:///${localSong.filePath.replace(/\\/g, '/')}`,
  cover: localSong.coverBase64 || '',
  lrc: '',
});

let initializing = false;

export const useLocalStore = create<LocalStore>((set, get) => {
  // 事件订阅只注册一次，在 store 创建时
  ipcRenderer.on('localMusic:folderChanged', (_event: any, payload: { type: 'add' | 'remove'; folderPath: string; songs?: LocalSong[]; songIds?: string[] }) => {
    get().handleFolderChange(payload);
  });

  return {
    folders: [],
    songs: [],
    currentFolder: null,
    isScanning: false,
    scanProgress: null,
    initialized: false,

    initialize: async () => {
      if (get().initialized || initializing) return;
      initializing = true;
      try {
        const [foldersResult, songsResult] = await Promise.all([
          IpcClient.invoke<LocalFolder[]>('localMusic:getFolders'),
          IpcClient.invoke<LocalSong[]>('localMusic:getSongs'),
        ]);
        set({
          folders: foldersResult,
          songs: songsResult.map(localSongToSong),
          initialized: true,
        });
      } catch (error) {
        console.error('初始化本地音乐失败:', error);
      } finally {
        initializing = false;
      }
    },

    addFolder: async () => {
      const result = await IpcClient.invoke<{ canceled: boolean; filePaths: string[] }>('dialog:openDirectory');
      if (result.canceled || !result.filePaths.length) return;

      const folderPath = result.filePaths[0];
      set({ isScanning: true });

      try {
        const { folder, songs } = await IpcClient.invoke<{ folder: LocalFolder; songs: LocalSong[] }>('localMusic:addFolder', folderPath);
        set(state => ({
          folders: [...state.folders.filter(f => f.path !== folder.path), folder],
          songs: [...state.songs, ...songs.map(localSongToSong)],
          isScanning: false,
          currentFolder: folder.path,
        }));
      } catch (error) {
        console.error('添加文件夹失败:', error);
        set({ isScanning: false });
      }
    },

    removeFolder: async (path: string) => {
      try {
        await IpcClient.invoke('localMusic:removeFolder', path);
        const normalizedPath = path.replace(/\\/g, '/');
        set(state => ({
          folders: state.folders.filter(f => f.path !== path),
          songs: state.songs.filter(s => !s.url.includes(normalizedPath)),
          currentFolder: state.currentFolder === path ? null : state.currentFolder,
        }));
      } catch (error) {
        console.error('移除文件夹失败:', error);
      }
    },

    refresh: async () => {
      set({ isScanning: true });
      try {
        const { folders, songs } = await IpcClient.invoke<{ folders: LocalFolder[]; songs: LocalSong[] }>('localMusic:refresh');
        set({
          folders,
          songs: songs.map(localSongToSong),
          isScanning: false,
        });
      } catch (error) {
        console.error('刷新失败:', error);
        set({ isScanning: false });
      }
    },

    setCurrentFolder: (path: string | null) => {
      set({ currentFolder: path });
    },

    handleFolderChange: (payload) => {
      const { type, folderPath, songs, songIds } = payload;
      if (type === 'add' && songs) {
        set(state => {
          const newSongs = songs.map(localSongToSong);
          const existingIds = new Set(state.songs.map(s => s.id));
          const uniqueNew = newSongs.filter(s => !existingIds.has(s.id));
          return {
            songs: [...state.songs, ...uniqueNew],
            folders: state.folders.map(f =>
              f.path === folderPath
                ? { ...f, songCount: f.songCount + uniqueNew.length }
                : f
            ),
          };
        });
      } else if (type === 'remove' && songIds) {
        set(state => ({
          songs: state.songs.filter(s => {
            const songPath = s.url.replace('file:///', '').replace(/\//g, '\\');
            return !songIds.includes(songPath);
          }),
          folders: state.folders.map(f =>
            f.path === folderPath
              ? { ...f, songCount: Math.max(0, f.songCount - songIds.length) }
              : f
          ),
        }));
      }
    },
  };
});