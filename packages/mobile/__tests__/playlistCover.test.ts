import { describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { playlistCoverSong } from '../components/playlistCover';

const song = (id: string): Song => ({
  id,
  name: id,
  artist: '',
  album: '',
  duration: 0,
  sourceType: 'netease',
  url: '',
  cover: `https://example.com/${id}.jpg`,
  lrc: '',
});

describe('歌单主图取第一首歌', () => {
  it('返回第一首歌', () => {
    expect(playlistCoverSong([song('a'), song('b')])?.id).toBe('a');
  });

  it('空歌单返回 null', () => {
    expect(playlistCoverSong([])).toBeNull();
  });
});
