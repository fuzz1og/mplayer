import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLRC } from '@mplayer/core';

import LyricsDisplay, { lineFillUnits, unitFillAt } from '@/renderer/components/LyricsDisplay';
import { playbackClock } from '@/renderer/services/playbackClock';

const fixturesDir = join(dirname(fileURLToPath(String(import.meta.url))), 'fixtures');
const kuwoLrcx = readFileSync(join(fixturesDir, 'kuwo-lrcx-075.txt'), 'utf8');
const PLAIN_LRC = '[00:00.00]故事的小黄花\n[00:04.00]从出生那年就飘着\n[00:08.00]童年的荡秋千';

/** 采样源读同一个可变值：时钟 tick 复核时不会把 seek 后的位置弹回去 */
let sampledPosition = 0;

function seek(position: number): void {
  sampledPosition = position;
  act(() => {
    playbackClock.setPosition(position);
  });
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

function activeLine(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.lyrics__line[data-active]');
}

function unitsOf(container: HTMLElement): HTMLElement[] {
  return [...(activeLine(container)?.querySelectorAll<HTMLElement>('.lyrics__unit') ?? [])];
}

function sungTexts(container: HTMLElement): string[] {
  return unitsOf(container)
    .filter((unit) => unit.hasAttribute('data-sung'))
    .map((unit) => unit.textContent ?? '');
}

function currentUnit(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.lyrics__line[data-active] .lyrics__unit[data-current]');
}

function fillOf(container: HTMLElement): number | null {
  const raw = currentUnit(container)?.style.getPropertyValue('--fill') ?? '';
  return raw ? Number.parseFloat(raw) : null;
}

describe('lineFillUnits（行 → 填充单元）', () => {
  const parsed = parseLRC('[00:00.00]故事的小黄花\n[00:04.00]从出生那年就飘着');

  it('普通 LRC：按字符切，行时长线性均分', () => {
    const units = lineFillUnits(parsed.lines[0], parsed.lines[1].time, 200);
    expect(units.map((unit) => unit.text).join('')).toBe('故事的小黄花');
    expect(units).toHaveLength(6);
    expect(units[0].time).toBe(0);
    expect(units[1].time).toBeCloseTo(4 / 6, 6);
    expect(units[0].duration).toBeCloseTo(4 / 6, 6);
    expect(units[5].time + units[5].duration).toBeCloseTo(4, 6);
  });

  it('逐字轨：直接用词时间，不做均分', () => {
    const first = parseLRC(kuwoLrcx).lines[0];
    const units = lineFillUnits(first, 2.996, 269);
    expect(units.map((unit) => unit.text)).toEqual(['起', '风', '了 ', '- ', '旺', '仔', '小', '乔']);
    expect(units[0].time).toBe(0);
    expect(units[1].time).toBeCloseTo(0.901, 6);
    expect(units[7].time + units[7].duration).toBeCloseTo(2.996, 6);
  });

  it('最后一行没有下一行：用整曲剩余时长，夹在 1.5~5s', () => {
    const line = { time: 100, text: 'abcd' };
    expect(lineFillUnits(line, null, 200)[0].duration).toBeCloseTo(5 / 4, 6);
    expect(lineFillUnits(line, null, 100.5)[0].duration).toBeCloseTo(1.5 / 4, 6);
  });
});

describe('unitFillAt（单元内进度纯函数）', () => {
  const units = [
    { text: '甲', time: 10, duration: 2 },
    { text: '乙', time: 12, duration: 1 },
  ];

  it('没有单元返回 null', () => {
    expect(unitFillAt(undefined, 10)).toBeNull();
    expect(unitFillAt([], 10)).toBeNull();
  });

  it('单元前夹到 0、单元后夹到 1', () => {
    expect(unitFillAt(units, 9)).toEqual({ index: 0, progress: 0 });
    expect(unitFillAt(units, 99)).toEqual({ index: 1, progress: 1 });
  });

  it('单元中返回已过的比例', () => {
    expect(unitFillAt(units, 11)).toEqual({ index: 0, progress: 0.5 });
    expect(unitFillAt(units, 12.25)).toEqual({ index: 1, progress: 0.25 });
  });

  it('零时长单元按已过 1 处理（不除零）', () => {
    expect(unitFillAt([{ text: '甲', time: 5, duration: 0 }], 5.2)).toEqual({ index: 0, progress: 1 });
  });
});

describe('歌词填充（#722：逐字轨 + 普通 LRC 线性）', () => {
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

  it('逐字轨：每词一个单元，暂停也同步画出已唱区段与当前词', () => {
    playbackClock.setPlaying(false);
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);

    expect(scheduled).toBe(0);
    expect(container.textContent).not.toContain('<');
    expect(unitsOf(container)).toHaveLength(8);
    expect(sungTexts(container)).toEqual(['起', '风', '了 ', '- ']);
    expect(currentUnit(container)?.textContent).toBe('- ');
    expect(fillOf(container)).toBeCloseTo(27.91, 1);
    // 非当前行不切单元
    expect(container.querySelectorAll('.lyrics__unit')).toHaveLength(8);
  });

  it('播放中每帧写当前单元 --fill，只在跨单元时改 data 属性', () => {
    playbackClock.setPlaying(true);
    const nowSpy = vi.spyOn(playbackClock, 'getPositionNow');
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(scheduled).toBe(1);
    expect(currentUnit(container)?.textContent).toBe('- ');

    const sungBefore = sungTexts(container);
    const fills: number[] = [];
    for (const position of [1.52, 1.6, 1.75]) {
      nowSpy.mockReturnValue(position);
      runFrame();
      fills.push(fillOf(container) as number);
    }
    expect(fills[0]).toBeLessThan(fills[1]);
    expect(fills[1]).toBeLessThan(fills[2]);
    expect(sungTexts(container)).toEqual(sungBefore); // 同一单元内不动 data 属性

    nowSpy.mockReturnValue(1.9);
    runFrame();
    expect(currentUnit(container)?.textContent).toBe('旺');
    expect(sungTexts(container)).toEqual(['起', '风', '了 ', '- ', '旺']);
  });

  it('暂停中 seek：同步重画且不起循环', () => {
    playbackClock.setPlaying(false);
    const { container } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(currentUnit(container)?.textContent).toBe('- ');

    seek(0.5);
    expect(currentUnit(container)?.textContent).toBe('起');
    expect(fillOf(container)).toBeCloseTo(55.49, 1);
    expect(scheduled).toBe(0);
  });

  it('普通 LRC：按字符切单元并线性填充', () => {
    playbackClock.setPlaying(false);
    const { container } = render(<LyricsDisplay lrcContent={PLAIN_LRC} />);

    const units = unitsOf(container);
    expect(units).toHaveLength(6);
    expect(units.map((unit) => unit.textContent).join('')).toBe('故事的小黄花');

    seek(0);
    expect(currentUnit(container)?.textContent).toBe('故');
    expect(fillOf(container)).toBe(0);

    // 行内 4s / 6 字：0.5s 落在第 1 个字内 75%
    seek(0.5);
    expect(currentUnit(container)?.textContent).toBe('故');
    expect(fillOf(container)).toBeCloseTo(75, 1);

    seek(2.5);
    expect(sungTexts(container)).toEqual(['故', '事', '的', '小']);
    expect(currentUnit(container)?.textContent).toBe('小');
    expect(fillOf(container)).toBeCloseTo(75, 1);
  });

  it('卸载时取消 rAF 循环', () => {
    playbackClock.setPlaying(true);
    const { unmount } = render(<LyricsDisplay lrcContent={kuwoLrcx} />);
    expect(scheduled).toBe(1);
    unmount();
    expect(cancelled.length).toBeGreaterThan(0);
  });
});
