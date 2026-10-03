import { describe, it, expect } from 'vitest';
import { filterDuplicates } from '@mplayer/core';
import type { Song } from '@mplayer/core';

const neteaseSong: Song = { id: '1', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 240, sourceType: 'netease', url: 'http://a.com/1', cover: 'http://a.com/c1', lrc: '' };
const qqSong: Song = { id: '2', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 250, sourceType: 'qq', url: 'http://b.com/2', cover: 'http://b.com/c2', lrc: '' };
const differentSong: Song = { id: '3', name: '七里香', artist: '周杰伦', album: '七里香', duration: 260, sourceType: 'netease', url: 'http://a.com/3', cover: 'http://a.com/c3', lrc: '' };

// 判据本身（classifySong）的用例在 core utils/__tests__/songDedupe.test.ts；
// 这里只留渲染层消费的聚合视图 filterDuplicates。
describe('filterDuplicates', () => {
  it('correctly classifies multiple songs', () => {
    const result = filterDuplicates([neteaseSong], [neteaseSong, qqSong, differentSong]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.ok).toHaveLength(1);
  });
});
