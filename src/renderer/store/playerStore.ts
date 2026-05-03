import { create } from 'zustand';
import { getGlobalPlayer, destroyGlobalPlayer, type PlayerState } from '@/renderer/services/audioPlayer';
import { lyricsService } from '@/renderer/services/lyricsService';
import { musicApi } from '@/main/api/musicApi';
import type { Song } from '@/shared/types/song';
import { ipcRenderer } from 'electron';

export type PlayMode = 'sequential' | 'list-loop' | 'single-loop' | 'shuffle';

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
}

export type PlayerStore = PlayerStoreState & PlayerStoreActions;

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
    console.log('播放结束，根据播放模式处理');
    const state = usePlayerStore.getState();
    state.playNext();
  }
});

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
  currentPlaylist: [],
  currentPlaylistIndex: -1,

  play: async (song: Song) => {
    const { isLoading, currentSong } = get();

    if (isLoading && currentSong?.id === song.id) {
      console.log('play() 被忽略，正在加载同一首歌');
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

      console.log('playerStore.play() 开始加载歌曲:', song.name, '原始URL:', song.url);

      let realUrl = song.url;
      try {
        realUrl = await musicApi.getAudioUrl(song.url);
        console.log('真实音频 URL:', realUrl);
      } catch (urlError) {
        console.error('获取真实音频 URL 失败:', urlError);
      }

      if (!realUrl) {
        throw new Error('无法获取音频 URL');
      }

      const songWithRealUrl = { ...song, url: realUrl };
      console.log('开始加载音频:', realUrl);
      await audioPlayer.load(songWithRealUrl);

      console.log('playerStore.play() 歌曲加载完成，准备播放');
      console.log('当前音频状态:', audioPlayer.getState());
      audioPlayer.play();
      console.log('播放命令已发送');

      const duration = audioPlayer.getDuration();

      set({
        duration: duration,
        isLoading: false
      });

      console.log('开始获取歌词，song.lrc:', song.lrc);
      if (song.lrc && song.lrc.trim() !== '') {
        set({ lyricsLoading: true });
        try {
          console.log('正在请求歌词URL:', song.lrc);
          const lyricsContent = await lyricsService.getLyrics(song.lrc);
          console.log('歌词获取成功，内容长度:', lyricsContent.length);
          set({ lyrics: lyricsContent, lyricsLoading: false });
        } catch (lyricsError) {
          console.error('获取歌词失败:', lyricsError);
          set({ lyrics: '', lyricsLoading: false });
        }
      } else {
        console.log('歌曲没有歌词URL，跳过获取');
        set({ lyrics: '', lyricsLoading: false });
      }

      await ipcRenderer.invoke('history:add', song);

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
  },

  resume: () => {
    audioPlayer.play();
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
      console.log('播放列表为空，停止播放');
      get().stop();
      return;
    }

    switch (playMode) {
      case 'single-loop':
        if (currentSong) {
          console.log('单曲循环，重新播放当前歌曲');
          get().play(currentSong);
        }
        break;

      case 'shuffle':
        const randomIndex = Math.floor(Math.random() * currentPlaylist.length);
        console.log('随机播放，选择索引:', randomIndex);
        set({ currentPlaylistIndex: randomIndex });
        get().play(currentPlaylist[randomIndex]);
        break;

      case 'list-loop':
        const nextIndexLoop = (currentPlaylistIndex + 1) % currentPlaylist.length;
        console.log('列表循环，下一首索引:', nextIndexLoop);
        set({ currentPlaylistIndex: nextIndexLoop });
        get().play(currentPlaylist[nextIndexLoop]);
        break;

      case 'sequential':
      default:
        if (currentPlaylistIndex < currentPlaylist.length - 1) {
          const nextIndex = currentPlaylistIndex + 1;
          console.log('顺序播放，下一首索引:', nextIndex);
          set({ currentPlaylistIndex: nextIndex });
          get().play(currentPlaylist[nextIndex]);
        } else {
          console.log('顺序播放结束');
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
  }
}));

export function destroyPlayer(): void {
  destroyGlobalPlayer();
}
