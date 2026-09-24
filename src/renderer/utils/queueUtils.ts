import type { Song } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';
import { getNextSongIndex } from '@mplayer/core';
import { isLegacyDeadUrl } from '@mplayer/core';

const QUEUE_STORAGE_KEY = 'mplayer_queue';
const PLAY_MODE_KEY = 'playMode';
const AUTO_SKIP_KEY = 'autoSkipOnError';

export function getNextSong(
  playlist: Song[],
  currentIndex: number,
  playMode: PlayMode,
  currentSong: Song | null,
): Song | null {
  if (!currentSong) return null;
  const nextIndex = getNextSongIndex(playlist, currentIndex, playMode);
  return nextIndex === -1 ? null : playlist[nextIndex];
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
        const playlist = data.playlist.map((song: Song) =>
          isLegacyDeadUrl(song.url) || isLegacyDeadUrl(song.cover) || isLegacyDeadUrl(song.lrc)
            ? { ...song, url: '', cover: '', lrc: '' }
            : song,
        );
        return {
          playlist,
          index: index >= 0 && index < playlist.length ? index : -1,
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

/**
 * 「失败即跳」偏好（#385）：播放失败时是否自动跳下一首。
 * 默认 **true**（保持现状行为，对齐 lx-music `autoSkipOnError` 默认）；关闭后
 * 失败即暂停并提示，把决定权交还用户。与 playMode 同属渲染端播放偏好，故同存 localStorage。
 */
export function getAutoSkipOnError(): boolean {
  try {
    return localStorage.getItem(AUTO_SKIP_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function persistAutoSkipOnError(value: boolean): void {
  try {
    localStorage.setItem(AUTO_SKIP_KEY, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}
