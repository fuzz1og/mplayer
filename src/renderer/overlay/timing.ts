import { findCurrentLyricIndex, parseLRC, type LyricLine } from '@mplayer/core';

/** 双端共享口径（#764）：current = lines[idx]、next = lines[idx+1]；idx<0 时 next 取第 0 行。 */
export interface OverlayLines {
  current: string;
  next: string;
}

export interface OverlayAnchor {
  positionSec: number;
  atMs: number;
  playing: boolean;
}

export function parseOverlayLines(lyricsText: string): LyricLine[] {
  if (!lyricsText.trim()) return [];
  try {
    return parseLRC(lyricsText).lines;
  } catch {
    return [];
  }
}

export function deriveOverlayLines(lines: readonly LyricLine[], positionSec: number): OverlayLines {
  if (lines.length === 0) return { current: '', next: '' };
  const index = findCurrentLyricIndex(lines, positionSec);
  if (index < 0) return { current: '', next: lines[0]?.text ?? '' };
  return {
    current: lines[index]?.text ?? '',
    next: lines[index + 1]?.text ?? '',
  };
}

export function anchorPosition(anchor: OverlayAnchor, nowMs: number): number {
  if (!anchor.playing) return anchor.positionSec;
  return anchor.positionSec + Math.max(0, nowMs - anchor.atMs) / 1000;
}

/** 距下一条行边界的毫秒数；暂停 / 末行返回 null（不排定时器，事件驱动不跑 rAF）。 */
export function msUntilNextLine(
  lines: readonly LyricLine[],
  positionSec: number,
  playing: boolean,
): number | null {
  if (!playing || lines.length === 0) return null;
  const boundary = lines.find((line) => line.time > positionSec);
  if (!boundary) return null;
  return Math.max(0, (boundary.time - positionSec) * 1000);
}
