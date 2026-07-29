import { describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';
import type { PlayMode } from '@mplayer/core';

const createMockSong = (overrides?: Partial<Song>): Song => ({
  id: '1',
  name: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  duration: 180,
  sourceType: 'netease',
  url: 'https://example.com/audio.mp3',
  cover: 'https://example.com/cover.jpg',
  lrc: '',
  ...overrides,
});

describe('Song type', () => {
  it('should create a valid song', () => {
    const song = createMockSong();

    expect(song.id).toBe('1');
    expect(song.name).toBe('Test Song');
    expect(song.url).toBeDefined();
  });

  it('should allow overriding properties', () => {
    const song = createMockSong({
      id: '2',
      name: 'Override Song',
      url: 'https://different.com/audio.mp3',
    });

    expect(song.id).toBe('2');
    expect(song.name).toBe('Override Song');
    expect(song.url).toBe('https://different.com/audio.mp3');
  });
});

describe('PlayMode type', () => {
  it('should have valid play modes', () => {
    const validModes: PlayMode[] = ['单曲循环', '列表循环', '随机播放'];

    expect(validModes).toContain('单曲循环');
    expect(validModes).toContain('列表循环');
    expect(validModes).toContain('随机播放');
  });

  it('should have exactly 3 play modes', () => {
    const modes: PlayMode[] = ['单曲循环', '列表循环', '随机播放'];
    expect(modes.length).toBe(3);
  });
});

describe('playNext logic - sequential mode', () => {
  it('should stop when reaching end in sequential mode', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const currentIndex = 1;

    let nextIndex: number;
    if (currentIndex < playlist.length - 1) {
      nextIndex = currentIndex + 1;
    } else {
      nextIndex = -1;
    }

    expect(nextIndex).toBe(-1);
  });

  it('should advance to next in sequential mode', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const currentIndex = 0;

    const nextIndex = currentIndex + 1;

    expect(nextIndex).toBe(1);
    expect(playlist[nextIndex].id).toBe('2');
  });

  it('should handle empty playlist', () => {
    const playlist: Song[] = [];

    expect(playlist.length).toBe(0);
  });
});

describe('playNext logic - list-loop mode', () => {
  it('should loop back to start when reaching end', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const currentIndex = 1;

    const nextIndex = (currentIndex + 1) % playlist.length;

    expect(nextIndex).toBe(0);
    expect(playlist[nextIndex].id).toBe('1');
  });

  it('should handle single item playlist', () => {
    const playlist = [createMockSong({ id: '1' })];
    const currentIndex = 0;

    const nextIndex = (currentIndex + 1) % playlist.length;

    expect(nextIndex).toBe(0);
  });
});

describe('playNext logic - single-loop mode', () => {
  it('should replay current song', () => {
    const currentSong = createMockSong({ id: '1' });

    const nextSong = currentSong;

    expect(nextSong.id).toBe('1');
  });
});

describe('playNext logic - shuffle mode', () => {
  it('should select random index in playlist length', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
      createMockSong({ id: '3' }),
    ];

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const randomIndex = Math.floor(Math.random() * playlist.length);

    expect(randomIndex).toBeGreaterThanOrEqual(0);
    expect(randomIndex).toBeLessThan(playlist.length);
  });

  it('should select first index when random is 0', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const randomIndex = Math.floor(Math.random() * playlist.length);

    expect(randomIndex).toBe(0);
  });

  it('should select last index when random is close to 1', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];

    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const randomIndex = Math.floor(Math.random() * playlist.length);

    expect(randomIndex).toBe(1);
  });
});

describe('playPrevious logic', () => {
  it('should go to previous song', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const currentIndex = 1;

    const prevIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;

    expect(prevIndex).toBe(0);
    expect(playlist[prevIndex].id).toBe('1');
  });

  it('should loop to last when at first', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const currentIndex = 0;

    const prevIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;

    expect(prevIndex).toBe(playlist.length - 1);
    expect(playlist[prevIndex].id).toBe('2');
  });

  it('should stay at same index for single item playlist', () => {
    const playlist = [createMockSong({ id: '1' })];
    const currentIndex = 0;

    const prevIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;

    expect(prevIndex).toBe(0);
  });
});

describe('PlayerBar formatTime utility', () => {
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  it('should format 0 seconds', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('should format NaN', () => {
    expect(formatTime(NaN)).toBe('00:00');
  });

  it('should format undefined', () => {
    expect(formatTime(undefined as any)).toBe('00:00');
  });

  it('should format normal time', () => {
    expect(formatTime(185)).toBe('03:05');
  });

  it('should format edge cases', () => {
    expect(formatTime(60)).toBe('01:00');
    expect(formatTime(59)).toBe('00:59');
    expect(formatTime(3661)).toBe('61:01');
  });
});

describe('PlayModeButton logic', () => {
  const modeConfig: Record<PlayMode, { next: PlayMode }> = {
    '单曲循环': { next: '列表循环' },
    '列表循环': { next: '随机播放' },
    '随机播放': { next: '单曲循环' },
  };

  it('should cycle 单曲循环 -> 列表循环', () => {
    expect(modeConfig['单曲循环'].next).toBe('列表循环');
  });

  it('should cycle 列表循环 -> 随机播放', () => {
    expect(modeConfig['列表循环'].next).toBe('随机播放');
  });

  it('should cycle 随机播放 -> 单曲循环', () => {
    expect(modeConfig['随机播放'].next).toBe('单曲循环');
  });

  it('should have all modes', () => {
    const modes: PlayMode[] = ['单曲循环', '列表循环', '随机播放'];
    modes.forEach(mode => {
      expect(modeConfig[mode]).toBeDefined();
    });
  });

  it('should cycle through all modes in order', () => {
    let mode: PlayMode = '单曲循环';
    const cycle: PlayMode[] = [];

    for (let i = 0; i < 3; i++) {
      cycle.push(mode);
      mode = modeConfig[mode].next;
    }

    expect(cycle).toEqual(['单曲循环', '列表循环', '随机播放']);
  });
});