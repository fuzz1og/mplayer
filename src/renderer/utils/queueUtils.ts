import type { Song } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';
import type { ShuffleState } from '@mplayer/core';
import { planAdvance } from '@mplayer/core';
import { isLegacyDeadUrl, syncShuffleCursor } from '@mplayer/core';

const QUEUE_STORAGE_KEY = 'mplayer_queue';
const PLAY_MODE_KEY = 'playMode';
const AUTO_SKIP_KEY = 'autoSkipOnError';

export function getNextSong(
  playlist: Song[],
  currentIndex: number,
  playMode: PlayMode,
  currentSong: Song | null,
  shuffle?: ShuffleState | null,
): Song | null {
  if (!currentSong) return null;
  // #541：推进落点统一走 planAdvance（与 playNext 同一份语义，不再各算一次）
  const plan = planAdvance({
    queue: playlist,
    currentIndex,
    playMode,
    shuffle: shuffle ?? null,
    direction: 1,
  });
  return plan.effect === 'none' ? null : playlist[plan.index];
}

/**
 * 落盘队列：成员 + 当前下标 + **随机序列**（#511）。
 * 序列与游标存的是同一个可序列化对象（core `ShuffleState`），重启后顺序不变。
 *
 * `shuffle` **必填**（#511 评审 major）：省略参数曾默认写成 `null` = 静默抹掉已落盘的随机序，
 * 新增调用点忘传时编译期抓不到。表达「没有序列」请显式传 `null`。
 */
export function persistQueue(playlist: Song[], index: number, shuffle: ShuffleState | null): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ playlist, index, shuffle }));
  } catch (e) {
    console.error('持久化播放队列失败:', e);
  }
}

export function loadQueue(): { playlist: Song[]; index: number; shuffle: ShuffleState | null } {
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
        const safeIndex = index >= 0 && index < playlist.length ? index : -1;
        return {
          playlist,
          index: safeIndex,
          // 存量/损坏数据兜底：成员对齐 + 游标对到当前曲（不是排列也会被修正成排列）
          shuffle: parseShuffleState(data.shuffle, playlist, safeIndex),
        };
      }
    }
  } catch (e) {
    console.error('加载播放队列失败:', e);
  }
  return { playlist: [], index: -1, shuffle: null };
}

/** 反序列化随机序列：形状不对就丢弃（null）；形状对就与恢复的队列/下标对齐。 */
function parseShuffleState(raw: unknown, playlist: Song[], index: number): ShuffleState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { order?: unknown; cursor?: unknown };
  if (!Array.isArray(candidate.order) || candidate.order.length === 0) return null;
  if (!candidate.order.every((id): id is string => typeof id === 'string')) return null;
  if (typeof candidate.cursor !== 'number' || !Number.isFinite(candidate.cursor)) return null;
  return syncShuffleCursor({ order: candidate.order, cursor: candidate.cursor }, playlist, index);
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
