import type { LyricLine } from '@mplayer/core';
import type { LyricOverlayBridge, LyricOverlaySnapshot } from '@/shared/lyricOverlay';
import {
  anchorPosition,
  deriveOverlayLines,
  msUntilNextLine,
  parseOverlayLines,
  type OverlayAnchor,
} from './timing';

export interface LyricOverlayMountOptions {
  now?: () => number;
  setTimeoutFn?: (handler: () => void, delayMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/** 行边界定时器的余量：定时器与挂钟的亚毫秒误差不该把换行卡在上一行。 */
const LINE_BOUNDARY_GUARD_MS = 10;

/**
 * 覆盖层页面（零取词 / 零判源）：只消费快照，本地时钟 + core 取行。
 * 事件驱动换行，不跑 rAF（#761 实测持续 60fps 造成可感知卡顿）。
 */
export function mountLyricOverlay(
  root: HTMLElement,
  bridge: LyricOverlayBridge,
  options: LyricOverlayMountOptions = {},
): () => void {
  const now = options.now ?? (() => performance.now());
  const setTimeoutFn =
    options.setTimeoutFn ?? ((handler: () => void, delayMs: number) => setTimeout(handler, delayMs));
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const pill = document.createElement('div');
  pill.className = 'lyric-overlay__pill';
  const currentEl = document.createElement('div');
  currentEl.className = 'lyric-overlay__current';
  const nextEl = document.createElement('div');
  nextEl.className = 'lyric-overlay__next';
  pill.append(currentEl, nextEl);
  root.classList.add('lyric-overlay');
  root.replaceChildren(pill);

  let snapshot: LyricOverlaySnapshot | null = null;
  let lines: LyricLine[] = [];
  let anchor: OverlayAnchor = { positionSec: 0, atMs: now(), playing: false };
  let timer: unknown = null;
  let disposed = false;
  let receivedPush = false;

  const cancelSchedule = (): void => {
    if (timer === null) return;
    clearTimeoutFn(timer);
    timer = null;
  };

  const render = (): void => {
    if (!snapshot) return;
    root.dataset.size = snapshot.lyricsSize;
    root.dataset.playing = snapshot.playing ? 'true' : 'false';
    if (!snapshot.enabled || !snapshot.visible || lines.length === 0) {
      root.dataset.visible = 'false';
      currentEl.textContent = '';
      nextEl.textContent = '';
      return;
    }
    root.dataset.visible = 'true';
    const { current, next } = deriveOverlayLines(lines, anchorPosition(anchor, now()));
    currentEl.textContent = current;
    nextEl.textContent = next;
  };

  const schedule = (): void => {
    cancelSchedule();
    if (!snapshot?.enabled || !snapshot.visible || !snapshot.playing) return;
    const delay = msUntilNextLine(lines, anchorPosition(anchor, now()), true);
    if (delay === null) return;
    timer = setTimeoutFn(() => {
      timer = null;
      render();
      schedule();
    }, delay + LINE_BOUNDARY_GUARD_MS);
  };

  const apply = (next: LyricOverlaySnapshot | null): void => {
    snapshot = next;
    lines = next ? parseOverlayLines(next.lyricsText) : [];
    if (next) anchor = { positionSec: next.positionSec, atMs: now(), playing: next.playing };
    render();
    schedule();
  };

  const unsubscribe = bridge.onState((next) => {
    receivedPush = true;
    apply(next);
  });
  render();
  void bridge
    .getState()
    .then((state) => {
      if (!disposed && !receivedPush) apply(state);
    })
    .catch(() => {
      // 主进程还没缓存快照：保持空白，等第一次推送
    });

  return () => {
    if (disposed) return;
    disposed = true;
    cancelSchedule();
    unsubscribe();
    root.replaceChildren();
  };
}
