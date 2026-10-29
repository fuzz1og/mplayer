import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LyricWord } from '@mplayer/core';

import LyricsDisplay, { wordFillAt } from '@/renderer/components/LyricsDisplay';
import { playbackClock } from '@/renderer/services/playbackClock';

const fixturesDir = join(dirname(fileURLToPath(String(import.meta.url))), 'fixtures');
const kuwoLrcx = readFileSync(join(fixturesDir, 'kuwo-lrcx-075.txt'), 'utf8');
const PLAIN_LRC = '[00:00.00]故事的小黄花\n[00:04.00]从出生那年就飘着';

/** 采样源读同一个可变值：时钟 tick 复核时不会把 seek 后的位置弹回去 */
let sampledPosition = 0;

function seek(position: number): void {
  sampledPosition = position;
  act(() => {
    playbackClock.setPosition(position);
  });
}

/** 当前行里带 data-sung 的词（行首 → 当前字，卡拉 OK 已唱区段） */
function sungWords(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.lyrics__line[data-active] .lyrics__word[data-sung]')]
    .map((word) => word.textContent ?? '');
}

function currentWord(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.lyrics__word[data-current-word]');
}

function fillPercent(element: HTMLElement | null): number | null {
  const raw = element?.style.getPropertyValue('--word-fill') ?? '';
  return raw ? Number.parseFloat(raw) : null;
}

/** rAF 桩：手动逐帧驱动，顺带记录起停（断言「暂停不跑循环」与卸载取消） */
const frames: FrameRequestCallback[] = [];
let scheduled = 0;
const cancelled: number[] = [];

function stubAnimationFrame(): void {
  scheduled = 0;
  frames.length = 0;
  cancelled.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    scheduled += 1;
    frames.push(callback);
    return scheduled;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id);
  });
}

function runFrame(): void {
  const callback = frames.shift();
  if (callback) callback(0);
}

describe('wordFillAt（词内进度纯函数）', () => {
  const words: LyricWord[] = [
    { time: 10, duration: 2, text: '甲' },
    { time: 12, duration: 1, text: '乙' },
  ];

  it('没有逐字轨道返回 null', () => {
    expect(wordFillAt(undefined, 10)).toBeNull();
    expect(wordFillAt([], 10)).toBeNull();
  });

  it('词前夹到 0、词后夹到 1', () => {
    expect(wordFillAt(words, 9)).toEqual({ index: 0, progress: 0 });
    expect(wordFillAt(words, 99)).toEqual({ index: 1, progress: 1 });
  });

  it('词中返回已过的比例', () => {
    expect(wordFillAt(words, 11)).toEqual({ index: 0, progress: 0.5 });
    expect(wordFillAt(words, 12.25)).toEqual({ index: 1, progress: 0.25 });
  });

  it('零时长词按已过 1 处理（不除零）', () => {
    expect(wordFillAt([{ time: 5, duration: 0, text: '甲' }], 5.2)).toEqual({ index: 0, progress: 1 });
  });
});

describe('歌词逐字 sweep + 字内填充（#722）', () => {
  beforeEach(() => {
    playbackClock.destroy();
    sampledPosition = 1.6;
    playbackClock.connect(() => sampledPosition);
    playbackClock.setDuration(269);
    playbackClock.setPosition(1.6);
    stubAnimationFrame();
  });

  afterEach(() => {
    playbackClock.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('当前行正文不含行内标签，已唱区段从行首连续到当前字', () => {
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);

    expect(container.textContent).not.toContain('<');
    const activeLines = container.querySelectorAll('.lyrics__line[data-active]');
    expect(activeLines).toHaveLength(1);
    expect(activeLines[0].textContent).toBe('起风了 - 旺仔小乔');

    // 1.6s 落在第 4 个词「- 」（1516~1817ms）内：行首到它共 4 个词标已唱
    expect(sungWords(container)).toEqual(['起', '风', '了 ', '- ']);
    const flags = [...activeLines[0].querySelectorAll('.lyrics__word')].map((word) => word.hasAttribute('data-sung'));
    expect(flags).toEqual([true, true, true, true, false, false, false, false]);
    expect(currentWord(container)?.textContent).toBe('- ');
    expect(container.querySelectorAll('.lyrics__line:not([data-active]) .lyrics__word[data-sung]')).toHaveLength(0);
    expect(container.querySelectorAll('.lyrics__word[data-current-word]')).toHaveLength(1);
  });

  it('时间推进/回退时已唱区段随之变长/变短', () => {
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(sungWords(container)).toHaveLength(4);

    seek(0.5);
    expect(sungWords(container)).toEqual(['起']);

    seek(2.0);
    expect(sungWords(container)).toEqual(['起', '风', '了 ', '- ', '旺']);
    expect(container.querySelectorAll('.lyrics__line[data-active]')).toHaveLength(1);
  });

  it('暂停时不起 rAF 循环；恢复播放后每帧把当前词的 --word-fill 写大', () => {
    playbackClock.setPlaying(false);
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(scheduled).toBe(0);
    expect(fillPercent(currentWord(container))).toBeNull();

    const nowSpy = vi.spyOn(playbackClock, 'getPositionNow');
    act(() => {
      playbackClock.setPlaying(true);
    });
    expect(scheduled).toBe(1);

    // 「起」0~0.901s：0.1 / 0.45 / 0.85 三帧
    const fills: number[] = [];
    for (const position of [0.1, 0.45, 0.85]) {
      nowSpy.mockReturnValue(position);
      runFrame();
      const fill = fillPercent(currentWord(container));
      expect(fill).not.toBeNull();
      fills.push(fill as number);
    }
    expect(fills[0]).toBeCloseTo(11.1, 1);
    expect(fills[1]).toBeCloseTo(49.94, 1);
    expect(fills[2]).toBeCloseTo(94.34, 1);
    expect(fills[0]).toBeLessThan(fills[1]);
    expect(fills[1]).toBeLessThan(fills[2]);
  });

  it('换字后当前词与填充跟着换，已唱区段不变', () => {
    playbackClock.setPlaying(true);
    const nowSpy = vi.spyOn(playbackClock, 'getPositionNow');
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(currentWord(container)?.textContent).toBe('- ');

    nowSpy.mockReturnValue(1.6);
    runFrame();
    expect(fillPercent(currentWord(container))).toBeCloseTo(27.91, 1);

    seek(2.0);
    expect(currentWord(container)?.textContent).toBe('旺');
    expect(fillPercent(currentWord(container))).toBeNull();
    nowSpy.mockReturnValue(1.9);
    runFrame();
    expect(fillPercent(currentWord(container))).toBeCloseTo(27.57, 1);
    expect(sungWords(container)).toHaveLength(5);
  });

  it('卸载时取消 rAF 循环', () => {
    playbackClock.setPlaying(true);
    const { unmount } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(scheduled).toBe(1);
    unmount();
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it('纯 LRC 仍按整行渲染，不产生逐字 span', () => {
    playbackClock.setPlaying(true);
    const { container } = render(<LyricsDisplay lrcContent={PLAIN_LRC} />);

    expect(container.querySelectorAll('.lyrics__word')).toHaveLength(0);
    expect(container.querySelector('[data-sung]')).toBeNull();
    expect(container.querySelector('[data-current-word]')).toBeNull();
    expect(container.querySelector('.lyrics__line[data-active]')?.textContent).toBe('故事的小黄花');
  });
});
