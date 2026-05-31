import { create } from 'zustand';
import { getGlobalPlayer, destroyGlobalPlayer, type PlayerState } from '@/renderer/services/audioPlayer';
import { lyricsService } from '@/renderer/services/lyricsService';
import type { Song } from '@/shared/types/song';
import type { PlayMode } from '@/shared/types/player';
import { IpcClient } from '@/renderer/services/IpcClient';
import { resolveSongUrls } from '@/renderer/utils/songResolver';
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

const QUEUE_STORAGE_KEY = 'mplayer_queue';

const persistQueue = (state: PlayerStoreState) => {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({
      playlist: state.currentPlaylist,
      index: state.currentPlaylistIndex,
    }));
  } catch (e) {
    console.error('持久化播放队列失败:', e);
  }
};

const loadQueue = (): { playlist: Song[]; index: number } => {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.playlist)) {
        return { playlist: data.playlist, index: data.index ?? -1 };
      }
    }
  } catch (e) {
    console.error('加载播放队列失败:', e);
  }
  return { playlist: [], index: -1 };
};

const getInitialPlayMode = (): PlayMode => {
  const saved = localStorage.getItem('playMode');
  if (saved && ['sequential', 'list-loop', 'single-loop', 'shuffle'].includes(saved)) {
    return saved as PlayMode;
  }
  return 'list-loop';
};

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

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentSong: null,
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
        if (song.url) {
          realUrl = song.url;
        } else {
          try {
            realUrl = await IpcClient.invoke<string>('musicApi:getSodaPlayableUrl', song.id);
          } catch (urlError) {
            console.error('获取汽水音乐可播放 URL 失败:', urlError);
          }
        }
      } else if (song.sourceType !== 'local') {
        try {
          realUrl = await IpcClient.invoke<string>('musicApi:getAudioUrl', song.url);
        } catch (urlError) {
          console.error('获取真实音频 URL 失败:', urlError);
        }
      }
      // local 歌曲直接使用 song.url（file:// 路径），无需获取真实 URL

      if (!realUrl) {
        throw new Error('无法获取音频 URL');
      }

      const songWithRealUrl = { ...song, url: realUrl };
      await audioPlayer.load(songWithRealUrl);

      audioPlayer.play();

      const duration = audioPlayer.getDuration();

      set({
        duration: duration,
        isLoading: false,
        isPlaying: true
      });

      if (!song.lrc || song.lrc.trim() === '') {
        set({ lyricsLoading: true });
        try {
          const searchResults = await resolveSongUrls(song.name, song.artist, song.sourceType);
          if (searchResults.length > 0) {
            const freshSong = searchResults[0];
            if (freshSong.lrc && freshSong.lrc.trim() !== '') {
              const lyricsContent = await lyricsService.getLyrics(freshSong.lrc);
              set({ lyrics: lyricsContent, lyricsLoading: false });
            } else {
              set({ lyrics: '', lyricsLoading: false });
            }
          } else {
            set({ lyrics: '', lyricsLoading: false });
          }
        } catch (lyricsError) {
          console.error('获取歌词失败:', lyricsError);
          set({ lyrics: '', lyricsLoading: false });
        }
      } else {
        set({ lyricsLoading: true });
        try {
          const lyricsContent = await lyricsService.getLyrics(song.lrc);
          set({ lyrics: lyricsContent, lyricsLoading: false });
        } catch (lyricsError) {
          console.error('获取歌词失败:', lyricsError);
          set({ lyrics: '', lyricsLoading: false });
        }
      }

      await IpcClient.invoke('history:add', song);

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
      persistQueue(get());

    } catch (error) {
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
    persistQueue(get());
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
    localStorage.setItem('playMode', mode);
  },

  playNext: () => {
    const { currentPlaylist, currentPlaylistIndex, playMode, currentSong } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      get().stop();
      return;
    }

    switch (playMode) {
      case 'single-loop':
        if (currentSong) {
          get().play(currentSong);
        }
        break;

      case 'shuffle':
        const randomIndex = Math.floor(Math.random() * currentPlaylist.length);
        set({ currentPlaylistIndex: randomIndex });
        get().play(currentPlaylist[randomIndex]);
        break;

      case 'list-loop':
        const nextIndexLoop = (currentPlaylistIndex + 1) % currentPlaylist.length;
        set({ currentPlaylistIndex: nextIndexLoop });
        get().play(currentPlaylist[nextIndexLoop]);
        break;

      case 'sequential':
      default:
        if (currentPlaylistIndex < currentPlaylist.length - 1) {
          const nextIndex = currentPlaylistIndex + 1;
          set({ currentPlaylistIndex: nextIndex });
          get().play(currentPlaylist[nextIndex]);
        } else {
          get().stop();
        }
        break;
    }
  },

  playPrevious: () => {
    const { currentPlaylist, currentPlaylistIndex, playMode } = get();

    if (currentPlaylist.length === 0 || currentPlaylistIndex === -1) {
      return;
    }

    if (playMode === 'shuffle') {
      const randomIndex = Math.floor(Math.random() * currentPlaylist.length);
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
    persistQueue(get());
  },

  removeFromQueue: (index: number) => {
    const { currentPlaylist, currentPlaylistIndex } = get();
    if (index < 0 || index >= currentPlaylist.length) return;

    const newPlaylist = currentPlaylist.filter((_, i) => i !== index);
    let newIndex = currentPlaylistIndex;

    if (newPlaylist.length === 0) {
      get().stop();
      persistQueue({ ...get(), currentPlaylist: [], currentPlaylistIndex: -1 });
      return;
    }

    if (index === currentPlaylistIndex) {
      // 移除的是当前播放歌曲，播放下一首
      const nextSong = newPlaylist[index] || newPlaylist[0];
      set({
        currentPlaylist: newPlaylist,
        currentPlaylistIndex: index < newPlaylist.length ? index : 0,
      });
      persistQueue(get());
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
    persistQueue(get());
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
    persistQueue(get());
  },

  clearQueue: () => {
    get().stop();
    set({
      currentPlaylist: [],
      currentPlaylistIndex: -1,
    });
    persistQueue(get());
  },
}));

// Sync state to tray when currentSong or isPlaying changes
// NOTE: ipcRenderer is already imported at line 6
usePlayerStore.subscribe((state) => {
  if (state.currentSong) {
    ipcRenderer.send('tray:state', {
      songName: state.currentSong.name,
      artist: state.currentSong.artist,
      isPlaying: state.isPlaying,
    });
  }
});

export function destroyPlayer(): void {
  destroyGlobalPlayer();
}
