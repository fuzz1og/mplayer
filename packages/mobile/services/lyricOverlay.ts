import { Platform } from 'react-native';
import {
  NativePlayer,
  isNativePlayerAvailable,
  type LyricOverlayLine,
  type LyricOverlayState,
} from '../modules/native-player';
import { useLyricsStore } from '../stores/lyricsStore';
import { useLyricOverlayStore } from '../stores/lyricOverlayStore';
import { useLogsStore } from '../stores/logsStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { songKey } from './nativePlayer';

/**
 * Android 歌词浮窗的 JS 宿主（#775 / 规格 2026-11-19-lyric-overlay §3.2）：
 * 开关意图单向回灌原生、整张 timing 表推送、切曲清表。窗口与时序推进都在原生。
 */

let initialized = false;
let lastSongKey: string | null = null;
let lastPushedSignature: string | null = null;

export function isLyricOverlaySupported(): boolean {
  if (Platform.OS !== 'android' || !isNativePlayerAvailable) return false;
  const version = Platform.Version;
  if (typeof version === 'number' && version < 26) return false;
  try {
    return !!NativePlayer?.isLyricOverlaySupported?.();
  } catch {
    return false;
  }
}

export function initLyricOverlay(): void {
  if (initialized || !isNativePlayerAvailable) return;
  initialized = true;
  useLyricOverlayStore.getState().setSupported(isLyricOverlaySupported());

  const player = NativePlayer;
  if (!player) return;

  player.addListener('lyricOverlayState', (state: LyricOverlayState) => {
    const previous = useLyricOverlayStore.getState();
    if (previous.permission && !state.permission && useSettingsStore.getState().floatingLyricsEnabled) {
      useLogsStore.getState().setNotice('info', '悬浮歌词权限已关闭，可在系统设置重新开启');
    }
    useLyricOverlayStore.getState().apply(state);
  });

  // 服务重启不持久化 timing 表 → 回灌意图并重推当前表（规格 §6.2 / §6.4）
  player.addListener('serviceState', () => {
    pushEnabledIntent(useSettingsStore.getState().floatingLyricsEnabled);
    refreshLyricOverlayState();
    lastSongKey = null;
    lastPushedSignature = null;
    syncLyricOverlay();
  });

  // JS 可能在原生 media transition 之前就推出新曲的表（歌词缓存命中 / 队列由 JS 先行更新）：
  // 原生按 trackKey ≠ 当前曲丢弃后不会再要一次 → 过渡完成时强制重推，否则整首空白。
  player.addListener('trackChanged', () => {
    lastPushedSignature = null;
    syncLyricOverlay(true);
  });

  useSettingsStore.subscribe((state, previous) => {
    if (state.floatingLyricsEnabled !== previous.floatingLyricsEnabled) {
      pushEnabledIntent(state.floatingLyricsEnabled);
    }
  });
  usePlayerStore.subscribe((state, previous) => {
    if (state.currentSong !== previous.currentSong) syncLyricOverlay();
  });
  useLyricsStore.subscribe((state, previous) => {
    if (state.songId !== previous.songId || state.lines !== previous.lines) syncLyricOverlay();
  });

  pushEnabledIntent(useSettingsStore.getState().floatingLyricsEnabled);
  useSettingsStore.persist?.onFinishHydration?.(() => {
    pushEnabledIntent(useSettingsStore.getState().floatingLyricsEnabled);
    refreshLyricOverlayState();
    syncLyricOverlay();
  });
  refreshLyricOverlayState();
  syncLyricOverlay();
}

export function setLyricOverlayEnabled(enabled: boolean): void {
  useSettingsStore.getState().setFloatingLyricsEnabled(enabled);
  pushEnabledIntent(enabled);
}

export function openLyricOverlaySettings(): void {
  try {
    NativePlayer?.openOverlaySettings?.();
  } catch {
    // 系统设置页不可达时保持无操作
  }
}

export function refreshLyricOverlayState(): void {
  try {
    const state = NativePlayer?.getLyricOverlayState?.();
    if (state) useLyricOverlayStore.getState().apply(state);
  } catch {
    // 服务未就绪时下一次事件会补齐
  }
}

/** 把当前曲的整张表推给原生；切曲先推空表（原生也会在 media transition 自行丢弃旧表）。 */
export function syncLyricOverlay(force = false): void {
  const player = NativePlayer;
  if (!player) return;

  const song = usePlayerStore.getState().currentSong;
  if (!song) {
    if (lastSongKey !== null) {
      lastSongKey = null;
      lastPushedSignature = null;
      safeSetLines('', []);
    }
    return;
  }

  const key = songKey(song);
  if (key !== lastSongKey) {
    lastSongKey = key;
    lastPushedSignature = null;
    safeSetLines(key, []);
  }

  const { songId, lines } = useLyricsStore.getState();
  if (songId !== song.id) return;

  const table: LyricOverlayLine[] = lines.map(({ time, text }) => ({ time, text }));
  const signature = `${key}|${table.map((line) => `${line.time}:${line.text}`).join('\n')}`;
  if (!force && signature === lastPushedSignature) return;
  lastPushedSignature = signature;
  safeSetLines(key, table);
}

function pushEnabledIntent(enabled: boolean): void {
  try {
    const state = NativePlayer?.setLyricOverlayEnabled?.(enabled);
    if (state) useLyricOverlayStore.getState().apply(state);
  } catch {
    // 原生不可用时仅保留 JS 侧意图
  }
}

function safeSetLines(trackKey: string, lines: LyricOverlayLine[]): void {
  try {
    NativePlayer?.setLyricLines?.(trackKey, lines);
  } catch {
    // 服务未就绪：serviceState 事件会触发重推
  }
}
