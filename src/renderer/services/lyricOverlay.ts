import { useSyncExternalStore } from 'react';
import { findCurrentLyricIndex, type LyricLine } from '@mplayer/core';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { playbackClock } from '@/renderer/services/playbackClock';
import { OverlayLyricsMemo, parseOverlayLines } from '@/renderer/overlay/timing';
import { readPrefs, subscribeAppearance } from '@/renderer/theme/appearancePrefs';
import {
  LYRIC_OVERLAY_STATE_CHANNEL,
  type LyricsSize,
  type LyricOverlaySnapshot,
} from '@/shared/lyricOverlay';

/** 开关持久键与值形态见 #769：'true' / 'false'，其它值按 false。 */
export const FLOATING_LYRICS_ENABLED_KEY = 'floatingLyricsEnabled';

const enabledListeners = new Set<(enabled: boolean) => void>();

export function readFloatingLyricsEnabled(): boolean {
  try {
    return localStorage.getItem(FLOATING_LYRICS_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setFloatingLyricsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(FLOATING_LYRICS_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // 隐私模式 / 配额失败：内存订阅照常生效，只是下次启动回到默认关
  }
  for (const listener of enabledListeners) listener(enabled);
}

export function toggleFloatingLyrics(): void {
  setFloatingLyricsEnabled(!readFloatingLyricsEnabled());
}

export function subscribeFloatingLyricsEnabled(listener: (enabled: boolean) => void): () => void {
  enabledListeners.add(listener);
  return () => {
    enabledListeners.delete(listener);
  };
}

export function useFloatingLyricsEnabled(): boolean {
  return useSyncExternalStore(
    subscribeFloatingLyricsEnabled,
    readFloatingLyricsEnabled,
    readFloatingLyricsEnabled,
  );
}

export interface LyricOverlaySourceState {
  enabled: boolean;
  playing: boolean;
  songId: string | null;
  lyricsText: string;
  positionSec: number;
  durationSec: number;
  lyricsSize: LyricsSize;
  hasPlaybackError: boolean;
}

/**
 * 可见性归 #764：无词 / 加载中 / 停止 / 队尾 / 错误隐藏；暂停冻结；
 * 前奏（idx<0）播放时可见，暂停且无当前行时隐藏（进入条件要求「暂停有当前行」）。
 * `parsedLines` 可由调用方的 memo 传入，省掉每次位置变化都重新 parseLRC。
 */
export function buildLyricOverlaySnapshot(
  source: LyricOverlaySourceState,
  parsedLines?: readonly LyricLine[],
): LyricOverlaySnapshot {
  const lines = parsedLines ?? parseOverlayLines(source.lyricsText);
  const currentIndex = findCurrentLyricIndex(lines, source.positionSec);
  const visible =
    source.enabled &&
    !source.hasPlaybackError &&
    source.songId !== null &&
    lines.length > 0 &&
    (source.playing || currentIndex >= 0);
  return {
    enabled: source.enabled,
    visible,
    playing: source.playing,
    songId: source.songId,
    lyricsText: source.lyricsText,
    positionSec: source.positionSec,
    durationSec: source.durationSec,
    lyricsSize: source.lyricsSize,
  };
}

/** seek 跳变判定阈值：正常 250ms 采样差值远小于它，覆盖层只在真跳变时重锚。 */
export const SEEK_JUMP_THRESHOLD_SEC = 1.5;
/** 暂停态位置比较容差：setPosition 是精确值，只需挡浮点噪声。 */
const PAUSED_POSITION_EPSILON_SEC = 0.05;
export const LYRIC_OVERLAY_HEARTBEAT_MS = 10_000;

export interface LyricOverlaySyncOptions {
  send?: (channel: string, snapshot: LyricOverlaySnapshot) => void;
  now?: () => number;
}

function snapshotsEqual(a: LyricOverlaySnapshot, b: LyricOverlaySnapshot): boolean {
  return (
    a.enabled === b.enabled &&
    a.visible === b.visible &&
    a.playing === b.playing &&
    a.songId === b.songId &&
    a.lyricsText === b.lyricsText &&
    a.durationSec === b.durationSec &&
    a.lyricsSize === b.lyricsSize
  );
}

/**
 * 主窗渲染层快照推送（#766）：切歌 / 歌词 / 播放暂停 / seek / 可见性 / 设置变化时推；
 * 播放且可见约 10s 心跳。不推当前行、不逐帧——换行由覆盖层本地时钟算。
 */
export function startLyricOverlaySync(options: LyricOverlaySyncOptions = {}): () => void {
  const now = options.now ?? (() => Date.now());
  const send =
    options.send ??
    ((channel: string, snapshot: LyricOverlaySnapshot) => {
      window.electronAPI?.send(channel, snapshot);
    });

  let lastSent: LyricOverlaySnapshot | null = null;
  let lastSentAt = 0;
  const linesMemo = new OverlayLyricsMemo();

  const buildSnapshot = (): LyricOverlaySnapshot => {
    const state = usePlayerStore.getState();
    return buildLyricOverlaySnapshot(
      {
        enabled: readFloatingLyricsEnabled(),
        playing: state.isPlaying,
        songId: state.currentSong?.id ?? null,
        lyricsText: state.lyrics,
        positionSec: playbackClock.getPositionNow(),
        durationSec: playbackClock.getSnapshot().duration,
        lyricsSize: readPrefs().lyricsSize,
        hasPlaybackError: state.error !== null,
      },
      linesMemo.linesFor(state.lyrics),
    );
  };

  const commit = (snapshot: LyricOverlaySnapshot): void => {
    lastSent = snapshot;
    lastSentAt = now();
    send(LYRIC_OVERLAY_STATE_CHANNEL, snapshot);
  };

  const push = (): void => {
    const snapshot = buildSnapshot();
    if (!lastSent) {
      commit(snapshot);
      return;
    }
    if (!snapshotsEqual(snapshot, lastSent)) {
      commit(snapshot);
      return;
    }
    const elapsedSec = (now() - lastSentAt) / 1000;
    const expectedPosition = lastSent.positionSec + (lastSent.playing ? elapsedSec : 0);
    const jumped = Math.abs(snapshot.positionSec - expectedPosition) > (
      snapshot.playing ? SEEK_JUMP_THRESHOLD_SEC : PAUSED_POSITION_EPSILON_SEC
    );
    if (jumped) commit(snapshot);
  };

  const heartbeat = setInterval(() => {
    if (!lastSent?.playing || !lastSent.visible) return;
    commit(buildSnapshot());
  }, LYRIC_OVERLAY_HEARTBEAT_MS);

  const unsubscribers = [
    usePlayerStore.subscribe(push),
    // 关闭时位置走表没有信息量（主进程已销毁 / 隐藏窗口）：不构建、不推送
    playbackClock.subscribe(() => {
      if (readFloatingLyricsEnabled()) push();
    }),
    playbackClock.subscribePlaying(push),
    subscribeAppearance(push),
    subscribeFloatingLyricsEnabled(push),
  ];

  push();

  return () => {
    clearInterval(heartbeat);
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
