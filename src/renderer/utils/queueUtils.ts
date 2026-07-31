import type { Song } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';

const QUEUE_STORAGE_KEY = 'mplayer_queue';
const PLAY_MODE_KEY = 'playMode';

export function getNextSong(
  playlist: Song[],
  currentIndex: number,
  playMode: PlayMode,
  currentSong: Song | null,
): Song | null {
  if (playlist.length === 0 || currentIndex === -1 || !currentSong) return null;

  switch (playMode) {
    case '单曲循环':
      return currentSong;
    case '随机播放': {
      if (playlist.length <= 1) return currentSong;
      let next: Song;
      do {
        next = playlist[Math.floor(Math.random() * playlist.length)];
      } while (next.id === currentSong.id);
      return next;
    }
    case '列表循环':
    default:
      return playlist[(currentIndex + 1) % playlist.length];
  }
}

export function persistQueue(playlist: Song[], index: number): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ playlist, index }));
  } catch (e) {
    console.error('持久化播放队列失败:', e);
  }
}

export function loadQueue(): { playlist: Song[]; index: number } {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.playlist) && data.playlist.length > 0) {
        const index = data.index ?? -1;
        return {
          playlist: data.playlist,
          index: index >= 0 && index < data.playlist.length ? index : -1,
        };
      }
    }
  } catch (e) {
    console.error('加载播放队列失败:', e);
  }
  return { playlist: [], index: -1 };
}

export function getInitialPlayMode(): PlayMode {
  const saved = localStorage.getItem(PLAY_MODE_KEY);
  if (saved && ['单曲循环', '列表循环', '随机播放'].includes(saved)) {
    return saved as PlayMode;
  }
  return '列表循环';
}

export function persistPlayMode(mode: PlayMode): void {
  try {
    localStorage.setItem(PLAY_MODE_KEY, mode);
  } catch {
    // ignore
  }
}
