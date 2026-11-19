/**
 * 悬浮歌词跨进程契约（ADR 2026-11-19-desktop-lyric-overlay-window / shared-contract）。
 * 主窗渲染层是唯一状态源；快照只带歌词原文与一次位置锚点，覆盖层本地算行。
 */

export const LYRIC_OVERLAY_STATE_CHANNEL = 'lyricOverlay:state';
export const LYRIC_OVERLAY_GET_STATE_CHANNEL = 'lyricOverlay:getState';

export type LyricsSize = 'standard' | 'large';

export interface LyricOverlaySnapshot {
  enabled: boolean;
  visible: boolean;
  playing: boolean;
  songId: string | null;
  lyricsText: string;
  positionSec: number;
  durationSec: number;
  lyricsSize: LyricsSize;
}

/** 覆盖层专用 preload 暴露的能力（不扩通用 invoke/send/on，见 #769）。 */
export interface LyricOverlayBridge {
  getState(): Promise<LyricOverlaySnapshot | null>;
  onState(listener: (snapshot: LyricOverlaySnapshot) => void): () => void;
}

declare global {
  interface Window {
    lyricOverlay: LyricOverlayBridge;
  }
}

/** 固定条宽只随字号档位变化（#770：standard → M 520×112、large → L 640）。 */
export const LYRIC_OVERLAY_SIZES: Record<LyricsSize, { width: number; height: number }> = {
  standard: { width: 520, height: 112 },
  large: { width: 640, height: 112 },
};

/** LRC 原文上界：正常歌词远小于此，超长只可能是被构造的报文。 */
export const LYRIC_OVERLAY_MAX_TEXT_LENGTH = 256 * 1024;

/** 主进程入口防御：预览快照来自渲染层，字段不合法整份丢弃。 */
export function sanitizeLyricOverlaySnapshot(input: unknown): LyricOverlaySnapshot | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean') return null;
  if (typeof value.visible !== 'boolean') return null;
  if (typeof value.playing !== 'boolean') return null;
  if (value.songId !== null && typeof value.songId !== 'string') return null;
  if (typeof value.lyricsText !== 'string') return null;
  if (typeof value.positionSec !== 'number' || !Number.isFinite(value.positionSec)) return null;
  if (typeof value.durationSec !== 'number' || !Number.isFinite(value.durationSec)) return null;
  if (value.lyricsSize !== 'standard' && value.lyricsSize !== 'large') return null;
  return {
    enabled: value.enabled,
    visible: value.visible,
    playing: value.playing,
    songId: value.songId,
    lyricsText: value.lyricsText.slice(0, LYRIC_OVERLAY_MAX_TEXT_LENGTH),
    positionSec: Math.max(0, value.positionSec),
    durationSec: Math.max(0, value.durationSec),
    lyricsSize: value.lyricsSize,
  };
}
