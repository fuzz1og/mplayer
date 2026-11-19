import { describe, expect, it } from 'vitest';
import { parseLRC } from '@mplayer/core';
import {
  anchorPosition,
  deriveOverlayLines,
  msUntilNextLine,
  parseOverlayLines,
} from '@/renderer/overlay/timing';

const LRC = '[00:05.00]第一句\n[00:10.00]第二句\n[00:15.00]第三句';

describe('覆盖层行推导与本地时钟（#764 / #766）', () => {
  it('当前行 + 下一句；末行下一句留空', () => {
    const lines = parseOverlayLines(LRC);
    expect(deriveOverlayLines(lines, 6)).toEqual({ current: '第一句', next: '第二句' });
    expect(deriveOverlayLines(lines, 16)).toEqual({ current: '第三句', next: '' });
  });

  it('前奏：当前行留空，第 0 行在下一句位', () => {
    expect(deriveOverlayLines(parseOverlayLines(LRC), 1)).toEqual({ current: '', next: '第一句' });
  });

  it('零行歌词 / 无词不产出文本（不显示空条）', () => {
    expect(deriveOverlayLines(parseOverlayLines('纯音乐，请欣赏'), 3)).toEqual({ current: '', next: '' });
    expect(deriveOverlayLines([], 3)).toEqual({ current: '', next: '' });
  });

  it('播放中按挂钟推进锚点，暂停冻结', () => {
    const playing = { positionSec: 6, atMs: 1000, playing: true };
    expect(anchorPosition(playing, 3000)).toBe(8);
    const paused = { positionSec: 6, atMs: 1000, playing: false };
    expect(anchorPosition(paused, 9000)).toBe(6);
  });

  it('下一行边界 = 距下一行的毫秒数；末行 / 暂停无调度', () => {
    const lines = parseOverlayLines(LRC);
    expect(msUntilNextLine(lines, 6, true)).toBe(4000);
    expect(msUntilNextLine(lines, 1, true)).toBe(4000);
    expect(msUntilNextLine(lines, 16, true)).toBeNull();
    expect(msUntilNextLine(lines, 6, false)).toBeNull();
  });

  it('parseLRC 的逐字标签不会漏进覆盖层文本（只做逐行）', () => {
    const lines = parseOverlayLines('[00:01.00]<1,2>你<3,4>好');
    expect(lines[0]?.text).toBe('你好');
    expect(parseLRC('[00:01.00]你').lines).toHaveLength(1);
  });
});
