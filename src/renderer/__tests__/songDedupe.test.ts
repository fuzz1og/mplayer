import { describe, it, expect } from 'vitest';
import { checkDuplicate, filterDuplicates } from '../utils/songDedupe';
import type { Song } from '@/shared/types/song';

const neteaseSong: Song = { id: '1', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 240, sourceType: 'netease', url: 'http://a.com/1', cover: 'http://a.com/c1', lrc: '' };
const qqSong: Song = { id: '2', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 250, sourceType: 'qq', url: 'http://b.com/2', cover: 'http://b.com/c2', lrc: '' };
const differentSong: Song = { id: '3', name: '七里香', artist: '周杰伦', album: '七里香', duration: 260, sourceType: 'netease', url: 'http://a.com/3', cover: 'http://a.com/c3', lrc: '' };

describe('checkDuplicate', () => {
  it('returns duplicate when same name and same source', () => {
    const result = checkDuplicate([neteaseSong], neteaseSong);
    expect(result.status).toBe('duplicate');
  });

  it('returns nameConflict when same name but different source', () => {
    const result = checkDuplicate([neteaseSong], qqSong);
    expect(result.status).toBe('nameConflict');
    expect(result.existingSong?.sourceType).toBe('netease');
  });

  it('returns ok when no conflict', () => {
    const result = checkDuplicate([neteaseSong], differentSong);
    expect(result.status).toBe('ok');
  });
});

describe('filterDuplicates', () => {
  it('correctly classifies multiple songs', () => {
    const result = filterDuplicates([neteaseSong], [neteaseSong, qqSong, differentSong]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.ok).toHaveLength(1);
  });
});
