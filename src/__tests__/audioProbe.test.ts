import { describe, expect, it } from 'vitest';
import { probeAudio } from '@mplayer/core';

describe('probeAudio', () => {
  const baseSong = {
    id: '1',
    name: 'test',
    artist: 'artist',
    album: '',
    url: '',
    cover: '',
    lrc: '',
  };

  it('soda empty url with short duration is preview', async () => {
    await expect(probeAudio({ ...baseSong, duration: 30, sourceType: 'soda' as const }))
      .resolves.toBe('preview');
  });

  it('soda empty url with unknown duration is valid', async () => {
    await expect(probeAudio({ ...baseSong, duration: 0, sourceType: 'soda' as const }))
      .resolves.toBe('valid');
  });

  it('non-soda empty url is invalid', async () => {
    await expect(probeAudio({ ...baseSong, duration: 0, sourceType: 'netease' as const }))
      .resolves.toBe('invalid');
  });
});
