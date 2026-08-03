import { describe, expect, it } from 'vitest';
import { calculateSimilarity, findBestMatch } from '../songMatcher.js';

describe('calculateSimilarity（严格匹配）', () => {
  it('name 完全匹配但 artist 不匹配 → 不匹配（防翻唱）', () => {
    // 网易云无版权场景：搜索「枫 周杰伦」第一条是别人的翻唱
    const score = calculateSimilarity(
      { name: '枫', artist: '周杰伦' },
      { name: '枫', artist: '翻唱者' }
    );
    expect(score).toBe(0);
  });

  it('name 与 artist 都匹配 → 匹配', () => {
    const score = calculateSimilarity(
      { name: '枫', artist: '周杰伦' },
      { name: '枫', artist: '周杰伦' }
    );
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('artist 轻微差异（多歌手/feat）仍匹配', () => {
    const score = calculateSimilarity(
      { name: '晴天', artist: '周杰伦' },
      { name: '晴天', artist: '周杰伦、杨瑞代' }
    );
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('缺 artist 信息时不因 artist 拦匹配（回退原行为）', () => {
    const score = calculateSimilarity(
      { name: '枫', artist: '周杰伦' },
      { name: '枫', artist: '' }
    );
    expect(score).toBeGreaterThanOrEqual(0.6);
  });
});

describe('findBestMatch', () => {
  it('翻唱不会胜出：同名不同歌手被拒绝', () => {
    const candidates = [
      { name: '枫', artist: '翻唱者', url: 'https://x.com/cover.mp3' },
      { name: '枫', artist: '周杰伦', url: 'https://x.com/original.mp3' },
    ];
    const match = findBestMatch({ name: '枫', artist: '周杰伦' }, candidates);
    expect(match?.song).toBe(candidates[1]);
  });

  it('只有翻唱时返回 null（宁可播放失败也不播错歌）', () => {
    const candidates = [
      { name: '枫', artist: '翻唱者', url: 'https://x.com/cover.mp3' },
    ];
    const match = findBestMatch({ name: '枫', artist: '周杰伦' }, candidates);
    expect(match).toBeNull();
  });
});
