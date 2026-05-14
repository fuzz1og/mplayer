import { create } from 'zustand';
import type { LocalFolder, LocalSong, Song } from '@/shared/types/song';

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

export const useLocalStore = create<LocalStore>((set, get) => ({
  folders: [],
  songs: [],
  currentFolder: null,
  isScanning: false,
  scanProgress: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    try {
      const [foldersResult, songsResult] = await Promise.all([
        ipcRenderer.invoke('localMusic:getFolders'),
        ipcRenderer.invoke('localMusic:getSongs'),
      ]);

      if (foldersResult.success && songsResult.success) {
        set({
          folders: foldersResult.data,
          songs: songsResult.data.map(localSongToSong),
          initialized: true,
        });
      }
    } catch (error) {
      console.error('初始化本地音乐失败:', error);
    }

    // 订阅 folderChanged 事件
    ipcRenderer.on('localMusic:folderChanged', (_event: any, payload: { type: 'add' | 'remove'; folderPath: string; songs?: LocalSong[]; songIds?: string[] }) => {
      get().handleFolderChange(payload);
    });
  },

  addFolder: async () => {
    const result = await ipcRenderer.invoke('dialog:openDirectory');
    if (result.canceled || !result.filePaths.length) return;

    const folderPath = result.filePaths[0];
    set({ isScanning: true });

    try {
      const addResult = await ipcRenderer.invoke('localMusic:addFolder', folderPath);
      if (addResult.success) {
        const { folder, songs } = addResult.data;
        set(state => ({
          folders: [...state.folders.filter(f => f.path !== folder.path), folder],
          songs: [...state.songs, ...songs.map(localSongToSong)],
          isScanning: false,
          currentFolder: folder.path,
        }));
      } else {
        set({ isScanning: false });
      }
    } catch (error) {
      console.error('添加文件夹失败:', error);
      set({ isScanning: false });
    }
  },

  removeFolder: async (path: string) => {
    try {
      const result = await ipcRenderer.invoke('localMusic:removeFolder', path);
      if (result.success) {
        set(state => ({
          folders: state.folders.filter(f => f.path !== path),
          songs: state.songs.filter(s => !s.url.includes(path)),
          currentFolder: state.currentFolder === path ? null : state.currentFolder,
        }));
      }
    } catch (error) {
      console.error('移除文件夹失败:', error);
    }
  },

  refresh: async () => {
    set({ isScanning: true });
    try {
      const result = await ipcRenderer.invoke('localMusic:refresh');
      if (result.success) {
        set({
          folders: result.data.folders,
          songs: result.data.songs.map(localSongToSong),
          isScanning: false,
        });
      } else {
        set({ isScanning: false });
      }
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
        songs: state.songs.filter(s => !songIds.includes(s.url.replace('file:///', '').replace(/\//g, '\\'))),
        folders: state.folders.map(f =>
          f.path === folderPath
            ? { ...f, songCount: Math.max(0, f.songCount - songIds.length) }
            : f
        ),
      }));
    }
  },
}));