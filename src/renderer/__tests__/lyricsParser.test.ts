import { describe, it, expect } from 'vitest';
import { parseLRC, findCurrentLyricIndex, formatLyricsTime, generateLRC } from '../utils/lyricsParser';

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
