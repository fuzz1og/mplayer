import { create } from 'zustand';
import { message } from 'antd';
import { getGlobalPlayer, destroyGlobalPlayer, type PlayerState } from '@/renderer/services/audioPlayer';
import type { Song } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { ipcMusicApi } from '@/renderer/services/IpcMusicApi';
import { resolveSongUrls } from '@/renderer/utils/songResolver';
import { getNextSong, persistQueue, loadQueue, getInitialPlayMode, persistPlayMode } from '@/renderer/utils/queueUtils';
const { ipcRenderer } = window.require('electron');

interface PlayerStoreState {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  position: number;
  duration: number;
  playerState: PlayerState;
  error: string | null;
  lyrics: string;
  lyricsLoading: boolean;
  playMode: PlayMode;
  currentPlaylist: Song[];
  currentPlaylistIndex: number;
}

interface PlayerStoreActions {
  play: (song: Song) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (position: number) => void;
  setVolume: (volume: number) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setPlayerState: (state: PlayerState) => void;
  clearError: () => void;
  togglePlay: () => void;
  setPlayMode: (mode: PlayMode) => void;
  playNext: () => void;
  playPrevious: () => void;
  setCurrentPlaylist: (playlist: Song[], currentIndex?: number) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
}

export type PlayerStore = PlayerStoreState & PlayerStoreActions;

let playGeneration = 0;

const audioPlayer = getGlobalPlayer({
  onStateChange: (state) => {
    usePlayerStore.getState().setPlayerState(state);
    usePlayerStore.setState({
      isPlaying: state === 'playing',
      isLoading: state === 'loading'
    });
  },
  onPositionChange: (position) => {
    usePlayerStore.getState().setPosition(position);
  },
  onDurationChange: (duration) => {
    usePlayerStore.getState().setDuration(duration);
  },
  onLoadError: (error) => {
    usePlayerStore.setState({
      error: error.message,
      isPlaying: false,
      isLoading: false
    });
  },
  onEnd: () => {
    const state = usePlayerStore.getState();
    state.playNext();
  }
});

const initialQueue = loadQueue();

// --- URL 预解析缓存 ---
const prefetchedUrls = new Map<string, string>();

/**
 * 获取队列中下一首歌（不改变播放状态）
 * 导出供测试使用
 */
export function getNextSongInQueue(state: PlayerStoreState): Song | null {
  return getNextSong(state.currentPlaylist, state.currentPlaylistIndex, state.playMode, state.currentSong);
}

/**
 * 后台预解析下一首歌的 URL（fire-and-forget）
 */
function prefetchNextUrl(state: PlayerStoreState): void {
  const nextSong = getNextSongInQueue(state);
  if (!nextSong || nextSong.sourceType === 'local') return;
  if (!nextSong.url) return;

  const cacheKey = `${nextSong.sourceType}:${nextSong.url}`;
  if (prefetchedUrls.has(cacheKey)) return;

  ipcMusicApi.getAudioUrl(nextSong.url)
    .then((resolvedUrl) => {
      if (resolvedUrl) {
        prefetchedUrls.set(cacheKey, resolvedUrl);
      }
    })
    .catch(() => {});
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentSong: initialQueue.index >= 0 && initialQueue.index < initialQueue.playlist.length
    ? initialQueue.playlist[initialQueue.index]
    : null,
  isPlaying: false,
  isLoading: false,
  volume: audioPlayer.getVolume(),
  position: 0,
  duration: 0,
  playerState: 'idle',
  error: null,
  lyrics: '',
  lyricsLoading: false,
  playMode: getInitialPlayMode(),
  currentPlaylist: initialQueue.playlist,
  currentPlaylistIndex: initialQueue.index,

  play: async (song: Song) => {
    const { isLoading, currentSong } = get();

    if (isLoading && currentSong?.id === song.id) {
      return;
    }

    const generation = ++playGeneration;
    audioPlayer.cancelLoad();

    try {
      set({
        error: null,
        isLoading: true,
        currentSong: song,
        position: 0,
        lyrics: '',
        lyricsLoading: false
      });

      let realUrl = song.url;

      if (song.sourceType === 'soda') {
        try {
          // Soda CDN links are signed and need the main-process download/cache path.
          realUrl = await ipcMusicApi.getSodaPlayableUrl(song.id);
        } catch (urlError) {
          console.error('获取汽水音乐可播放 URL 失败:', urlError);
          realUrl = song.url || '';
        }
      } else if (song.sourceType !== 'local') {
        const cacheKey = `${song.sourceType}:${song.url}`;
        const prefetched = prefetchedUrls.get(cacheKey);
        if (prefetched) {
          realUrl = prefetched;
          prefetchedUrls.delete(cacheKey);
        } else {
          try {
            realUrl = await ipcMusicApi.getAudioUrl(song.url);
          } catch (urlError) {
            console.error('获取真实音频 URL 失败:', urlError);
            message.error(urlError instanceof Error ? urlError.message : '无法播放此歌曲');
            realUrl = '';
          }
        }
      }

      if (generation !== playGeneration) {
        set({ isLoading: false });
        return;
      }

      if (!realUrl) {
        set({ isLoading: false });
        throw new Error('无法获取音频 URL，可能网络不稳定或歌曲已下架');
      }

      const songWithRealUrl = { ...song, url: realUrl };
      await audioPlayer.load(songWithRealUrl);

      if (generation !== playGeneration) {
        set({ isLoading: false });
        return;
      }

      audioPlayer.play();

      const duration = audioPlayer.getDuration();

      set({
        duration: duration,
        isLoading: false,
        isPlaying: true
      });

      prefetchNextUrl(get());

      // Fire-and-forget: 歌词获取不阻塞播放
      const requestingSongId = song.id;
      if (!song.lrc || song.lrc.trim() === '') {
        set({ lyricsLoading: true });
        resolveSongUrls(song.name, song.artist, song.sourceType)
          .then((searchResults) => {
            if (get().currentSong?.id !== requestingSongId) return null;
            if (searchResults.length > 0) {
              const freshSong = searchResults[0];
              if (freshSong.lrc && freshSong.lrc.trim() !== '') {
                return IpcClient.invoke<string>('lyrics:get', freshSong.lrc);
              }
            }
            return '';
          })
          .then((lyricsContent) => {
            if (lyricsContent !== null && get().currentSong?.id === requestingSongId) {
              set({ lyrics: lyricsContent, lyricsLoading: false });
            } else if (lyricsContent === null) {
              set({ lyricsLoading: false });
            }
          })
          .catch((lyricsError) => {
            console.error('获取歌词失败:', lyricsError);
            if (get().currentSong?.id === requestingSongId) {
              set({ lyrics: '', lyricsLoading: false });
            }
          });
      } else {
        set({ lyricsLoading: true });
        IpcClient.invoke<string>('lyrics:get', song.lrc)
          .then((lyricsContent) => {
            if (get().currentSong?.id === requestingSongId) {
              set({ lyrics: lyricsContent, lyricsLoading: false });
            }
          })
          .catch((lyricsError) => {
            console.error('获取歌词失败:', lyricsError);
            if (get().currentSong?.id === requestingSongId) {
              set({ lyrics: '', lyricsLoading: false });
            }
          });
      }

      // Fire-and-forget: 历史记录写入不阻塞播放
      IpcClient.invoke('history:add', song).catch((err) => {
        console.error('写入播放历史失败:', err);
      });

      // 同步更新队列（本地操作，无 IPC 开销）
      const playlist = get().currentPlaylist;
      const index = playlist.findIndex(s => s.id === song.id);
      if (index === -1) {
        const newPlaylist = [...playlist, song];
        set({
          currentPlaylist: newPlaylist,
          currentPlaylistIndex: newPlaylist.length - 1
        });
      } else {
        set({ currentPlaylistIndex: index });
      }
      persistQueue(get().currentPlaylist, get().currentPlaylistIndex);

    } catch (error) {
      if (generation !== playGeneration) return;
      set({
        error: error instanceof Error ? error.message : '播放失败',
        isLoading: false,
        isPlaying: false
      });
    }
  },

  pause: () => {
    audioPlayer.pause();
    set({ isPlaying: false });
  },

  resume: () => {
    audioPlayer.play();
    set({ isPlaying: true });
  },

  stop: () => {
    audioPlayer.stop();
    set({
      currentSong: null,
      isPlaying: false,
      position: 0,
      duration: 0,
      currentPlaylistIndex: -1
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
  },

  seek: (position: number) => {
    audioPlayer.seek(position);
    set({ position });
  },

  setVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    audioPlayer.setVolume(clampedVolume);
    set({ volume: clampedVolume });
  },

  setPosition: (position: number) => {
    set({ position });
  },

  setDuration: (duration: number) => {
    set({ duration });
  },

  setPlayerState: (state: PlayerState) => {
    set({ playerState: state });
  },

  clearError: () => {
    set({ error: null });
  },

  togglePlay: () => {
    const { currentSong, isPlaying } = get();
    if (!currentSong) return;

    if (isPlaying) {
      get().pause();
    } else {
      get().resume();
    }
  },

  setPlayMode: (mode: PlayMode) => {
    set({ playMode: mode });
    persistPlayMode(mode);
  },

  playNext: () => {
    const { currentPlaylist, currentPlaylistIndex, playMode, currentSong } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      get().stop();
      return;
    }

    switch (playMode) {
      case '单曲循环':
        if (currentSong) {
          audioPlayer.seek(0);
          audioPlayer.play();
          set({ position: 0, isPlaying: true, error: null });
        }
        break;

      case '随机播放': {
        let randomIndex = currentPlaylistIndex;
        if (currentPlaylist.length > 1) {
          do {
            randomIndex = Math.floor(Math.random() * currentPlaylist.length);
          } while (randomIndex === currentPlaylistIndex);
        }
        set({ currentPlaylistIndex: randomIndex });
        get().play(currentPlaylist[randomIndex]);
        break;
      }

      case '列表循环':
      default: {
        const nextIndexLoop = (currentPlaylistIndex + 1) % currentPlaylist.length;
        set({ currentPlaylistIndex: nextIndexLoop });
        get().play(currentPlaylist[nextIndexLoop]);
        break;
      }
    }
  },

  playPrevious: () => {
    const { currentPlaylist, currentPlaylistIndex, playMode } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      return;
    }

    if (playMode === '随机播放') {
      let randomIndex = currentPlaylistIndex;
      if (currentPlaylist.length > 1) {
        do {
          randomIndex = Math.floor(Math.random() * currentPlaylist.length);
        } while (randomIndex === currentPlaylistIndex);
      }
      set({ currentPlaylistIndex: randomIndex });
      get().play(currentPlaylist[randomIndex]);
    } else {
      const prevIndex = currentPlaylistIndex > 0
        ? currentPlaylistIndex - 1
        : currentPlaylist.length - 1;
      set({ currentPlaylistIndex: prevIndex });
      get().play(currentPlaylist[prevIndex]);
    }
  },

  setCurrentPlaylist: (playlist: Song[], currentIndex: number = -1) => {
    set({
      currentPlaylist: playlist,
      currentPlaylistIndex: currentIndex
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
  },

  removeFromQueue: (index: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (index < 0 || index >= currentPlaylist.length) return;

    const newPlaylist = currentPlaylist.filter((_, i) => i !== index);
    let newIndex = currentPlaylistIndex;

    if (newPlaylist.length === 0) {
      get().stop();
      persistQueue([], -1);
      return;
    }

    if (index === currentPlaylistIndex) {
      // 移除的是当前播放歌曲，播放下一首
      const nextSong = newPlaylist[index] || newPlaylist[0];
      set({
        currentPlaylist: newPlaylist,
        currentPlaylistIndex: index < newPlaylist.length ? index : 0,
      });
      persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
      get().play(nextSong);
      return;
    }

    if (index < currentPlaylistIndex) {
      newIndex = currentPlaylistIndex - 1;
    }

    set({
      currentPlaylist: newPlaylist,
      currentPlaylistIndex: newIndex,
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
  },

  reorderQueue: (fromIndex: number, toIndex: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (fromIndex < 0 || fromIndex >= currentPlaylist.length) return;
    if (toIndex < 0 || toIndex >= currentPlaylist.length) return;
    if (fromIndex === toIndex) return;

    const newPlaylist = [...currentPlaylist];
    const [moved] = newPlaylist.splice(fromIndex, 1);
    newPlaylist.splice(toIndex, 0, moved);

    // 同步更新 currentPlaylistIndex
    let newIndex = currentPlaylistIndex;
    if (currentPlaylistIndex === fromIndex) {
      newIndex = toIndex;
    } else if (fromIndex < currentPlaylistIndex && toIndex >= currentPlaylistIndex) {
      newIndex = currentPlaylistIndex - 1;
    } else if (fromIndex > currentPlaylistIndex && toIndex <= currentPlaylistIndex) {
      newIndex = currentPlaylistIndex + 1;
    }

    set({
      currentPlaylist: newPlaylist,
      currentPlaylistIndex: newIndex,
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
  },

  clearQueue: () => {
    get().stop();
    set({
      currentPlaylist: [],
      currentPlaylistIndex: -1,
    });
    persistQueue(get().currentPlaylist, get().currentPlaylistIndex);
  },
}));

// Sync state to tray when currentSong or isPlaying changes
// NOTE: ipcRenderer is already imported at line 6
let lastTraySongId = '';
let lastTrayIsPlaying: boolean | null = null;
usePlayerStore.subscribe((state) => {
  if (state.currentSong) {
    const songChanged = state.currentSong.id !== lastTraySongId;
    const playStateChanged = state.isPlaying !== lastTrayIsPlaying;
    if (songChanged || playStateChanged) {
      lastTraySongId = state.currentSong.id;
      lastTrayIsPlaying = state.isPlaying;
      ipcRenderer.send('tray:state', {
        songName: state.currentSong.name,
        artist: state.currentSong.artist,
        isPlaying: state.isPlaying,
      });
    }
  }
});

export function destroyPlayer(): void {
  destroyGlobalPlayer();
}
