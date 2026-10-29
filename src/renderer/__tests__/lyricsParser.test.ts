import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLRC, findCurrentLyricIndex, formatLyricsTime, generateLRC } from '@mplayer/core';

const fixturesDir = join(dirname(fileURLToPath(String(import.meta.url))), 'fixtures');

/** #722 真样本：newlyric.kuwo.cn 带 lrcx=1 解出来的正文，见 docs/research/2026-10-29-kuwo-lrcx-word-timed-lyrics.md */
function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('lyricsParser', () => {
  describe('parseLRC', () => {
    it('should parse standard LRC format', () => {
      const lrc = `[00:01.00]第一行
[00:05.00]第二行
[00:10.00]第三行`;
      const result = parseLRC(lrc);
      expect(result.lines).toHaveLength(3);
      expect(result.lines[0].time).toBe(1);
      expect(result.lines[0].text).toBe('第一行');
      expect(result.lines[1].time).toBe(5);
      expect(result.lines[2].time).toBe(10);
    });

    it('should return empty array for empty input', () => {
      const result = parseLRC('');
      expect(result.lines).toHaveLength(0);
      expect(result.hasTranslation).toBe(false);
    });

    it('should handle LRC with metadata tags', () => {
      const lrc = `[ti:Song Title]
[ar:Artist Name]
[00:01.00]歌词行`;
      const result = parseLRC(lrc);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].text).toBe('歌词行');
    });

    it('should sort lyrics by time', () => {
      const lrc = `[00:10.00]第三行
[00:01.00]第一行
[00:05.00]第二行`;
      const result = parseLRC(lrc);
      expect(result.lines[0].time).toBe(1);
      expect(result.lines[1].time).toBe(5);
      expect(result.lines[2].time).toBe(10);
    });

    it('should filter out empty text lines', () => {
      const lrc = `[00:01.00]第一行
[00:05.00]
[00:10.00]第三行`;
      const result = parseLRC(lrc);
      expect(result.lines).toHaveLength(2);
    });
  });

  describe('findCurrentLyricIndex', () => {
    const lines = [
      { time: 1, text: '第一行' },
      { time: 5, text: '第二行' },
      { time: 10, text: '第三行' },
      { time: 20, text: '第四行' },
    ];

    it('should return -1 for empty lyrics', () => {
      expect(findCurrentLyricIndex([], 0)).toBe(-1);
    });

    it('should return -1 when before first lyric', () => {
      // binary search: right starts at -1 when currentTime < lines[0].time
      expect(findCurrentLyricIndex(lines, 0)).toBe(-1);
    });

    it('should find correct lyric index', () => {
      // binary search returns right = last index where lines[mid].time <= currentTime
      expect(findCurrentLyricIndex(lines, 3)).toBe(0); // between line 0 and 1
      expect(findCurrentLyricIndex(lines, 5)).toBe(1); // exactly at line 1
      expect(findCurrentLyricIndex(lines, 7)).toBe(1); // between line 1 and 2
      expect(findCurrentLyricIndex(lines, 15)).toBe(2); // between line 2 and 3
      expect(findCurrentLyricIndex(lines, 25)).toBe(3); // after line 3
    });

    it('should handle exact time matches', () => {
      expect(findCurrentLyricIndex(lines, 1)).toBe(0);
      expect(findCurrentLyricIndex(lines, 10)).toBe(2);
    });
  });

  describe('formatLyricsTime', () => {
    it('should format seconds to [MM:SS.ms]', () => {
      expect(formatLyricsTime(0)).toBe('[00:00.00]');
      expect(formatLyricsTime(65)).toBe('[01:05.00]');
      expect(formatLyricsTime(3661)).toBe('[61:01.00]');
    });

    it('should handle fractional seconds', () => {
      const result = formatLyricsTime(65.5);
      expect(result).toBe('[01:05.50]');
    });
  });

  describe('generateLRC', () => {
    it('should generate LRC from lyrics array', () => {
      const lines = [
        { time: 1, text: '第一行' },
        { time: 5, text: '第二行' },
      ];
      const result = generateLRC(lines);
      expect(result).toContain('[00:01.00]第一行');
      expect(result).toContain('[00:05.00]第二行');
    });

    it('should return empty string for empty input', () => {
      expect(generateLRC([])).toBe('');
    });
  });
});
describe('parseLRC 逐字时间轴（酷我 lrcx，#722）', () => {
  it('行正文不含行内标签，逐字时间轴按 [kuwo:075] 的系数还原（k1=6, k2=1）', () => {
    const result = parseLRC(fixture('kuwo-lrcx-075.txt'));

    expect(result.lines.map((line) => line.text)).toEqual([
      '起风了 - 旺仔小乔',
      '词：米果',
      '曲：高橋優',
      '原编曲：池窪浩一 (Kouichi Ikekubo)',
      '改编编曲：卡其漠罗洋',
    ]);

    const first = result.lines[0];
    expect(first.time).toBe(0);
    expect(first.words?.map((word) => word.text)).toEqual(['起', '风', '了 ', '- ', '旺', '仔', '小', '乔']);
    // 起点 = |a+b| / (2·k1)、时长 = |a−b| / (2·k2)，单位毫秒、相对行首
    expect(first.words?.[0]).toMatchObject({ time: 0, duration: 0.901, text: '起' });
    expect(first.words?.[1].time).toBeCloseTo(0.901, 6);
    expect(first.words?.[1].duration).toBeCloseTo(0.32, 6);
  });

  it('逐字铺满整行：末字终点等于下一行时间戳，且起点单调不减', () => {
    const result = parseLRC(fixture('kuwo-lrcx-075.txt'));
    const words = result.lines[0].words ?? [];
    const last = words[words.length - 1];
    expect(last.time + last.duration).toBeCloseTo(result.lines[1].time, 6);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].time).toBeGreaterThanOrEqual(words[i - 1].time);
    }
  });

  it('换算系数跟着文件头走：[kuwo:041] 解成 k1=3, k2=3', () => {
    const [firstLine] = parseLRC(fixture('kuwo-lrcx-041.txt')).lines;
    expect(firstLine.time).toBeCloseTo(23.79, 6);
    expect(firstLine.words?.[0]).toMatchObject({ time: 23.79, duration: 1.11, text: '你' });
    expect(firstLine.words?.[1].time).toBeCloseTo(26.49, 6);
    expect(firstLine.words?.[1].duration).toBeCloseTo(0.27, 6);
  });

  it('缺文件头（拿不到换算系数）时只剥标签，不给逐字轨道', () => {
    const [line] = parseLRC('[00:01.00]<100,-100>你<300,100>好').lines;
    expect(line).toEqual({ time: 1, text: '你好' });
    expect(line.words).toBeUndefined();
  });

  it('整行标记都是 <0,0> 的译文/占位行只保留正文', () => {
    const [line] = parseLRC('[kuwo:075]\n[00:01.000]<0,0>我从未<0,0>走远').lines;
    expect(line.text).toBe('我从未走远');
    expect(line.words).toBeUndefined();
  });

  it('词区间重叠时截断前一个词（酷我客户端同款处理）', () => {
    // [kuwo:100] → 八进制 100 = 十进制 64 → k1=6, k2=4，即 a=6s+4d、b=6s−4d
    const [line] = parseLRC('[kuwo:100]\n[00:00.000]<4000,-4000>甲<3400,2600>乙').lines;
    expect(line.words?.[0]).toMatchObject({ time: 0, duration: 0.5, text: '甲' });
    expect(line.words?.[1].time).toBeCloseTo(0.5, 6);
    expect(line.words?.[1].duration).toBeCloseTo(0.1, 6);
  });

  it('纯 LRC 行不产生 words 字段（既有行为不变）', () => {
    const result = parseLRC('[00:01.00]第一行');
    expect(result.lines[0]).toEqual({ time: 1, text: '第一行' });
    expect('words' in result.lines[0]).toBe(false);
  });
});
