import { describe, it, expect } from 'vitest';
import { calculateSimilarity, findBestMatch } from '../utils/songMatcher';

describe('songMatcher', () => {
  describe('calculateSimilarity', () => {
    it('should return high score for identical songs', () => {
      const score = calculateSimilarity(
        { name: '晴天', artist: '周杰伦' },
        { name: '晴天', artist: '周杰伦' }
      );
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('should return 0 for completely different songs', () => {
      const score = calculateSimilarity(
        { name: '晴天', artist: '周杰伦' },
        { name: '月亮代表我的心', artist: '邓丽君' }
      );
      expect(score).toBe(0);
    });

    it('should handle songs with same name but different artist', () => {
      const score = calculateSimilarity(
        { name: '晴天', artist: '周杰伦' },
        { name: '晴天', artist: '其他歌手' }
      );
      // Should still have some score due to name match
      expect(score).toBeGreaterThan(0.5);
    });

    it('should handle substring matching', () => {
      const score = calculateSimilarity(
        { name: '晴天', artist: '周杰伦' },
        { name: '晴天 (Live)', artist: '周杰伦' }
      );
      expect(score).toBeGreaterThan(0);
    });

    it('should handle Chinese punctuation normalization', () => {
      const score = calculateSimilarity(
        { name: '你好！世界', artist: '歌手A' },
        { name: '你好世界', artist: '歌手A' }
      );
      expect(score).toBeGreaterThan(0.8);
    });

    it('should handle feat. artist splitting', () => {
      const score = calculateSimilarity(
        { name: '歌曲', artist: '歌手A' },
        { name: '歌曲', artist: '歌手A feat. 歌手B' }
      );
      expect(score).toBeGreaterThan(0.6);
    });

    it('should handle empty artist gracefully', () => {
      const score = calculateSimilarity(
        { name: '晴天', artist: '' },
        { name: '晴天', artist: '周杰伦' }
      );
      expect(score).toBeGreaterThan(0.5);
    });
  });

  describe('findBestMatch', () => {
    it('should find the best matching song', () => {
      const candidates = [
        { name: '月亮代表我的心', artist: '邓丽君' },
        { name: '晴天', artist: '周杰伦' },
        { name: '简单爱', artist: '周杰伦' },
      ];
      const result = findBestMatch(
        { name: '晴天', artist: '周杰伦' },
        candidates
      );
      expect(result).not.toBeNull();
      expect(result!.song.name).toBe('晴天');
    });

    it('should return null when no match above threshold', () => {
      const candidates = [
        { name: '完全不同的歌', artist: '其他歌手' },
      ];
      const result = findBestMatch(
        { name: '晴天', artist: '周杰伦' },
        candidates
      );
      expect(result).toBeNull();
    });

    it('should return null for empty candidates', () => {
      const result = findBestMatch(
        { name: '晴天', artist: '周杰伦' },
        []
      );
      expect(result).toBeNull();
    });
  });
});
