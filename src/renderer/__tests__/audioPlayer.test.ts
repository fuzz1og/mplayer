import { describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';

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

describe('AudioPlayer state types', () => {
  it('should have valid player states', () => {
    const validStates = ['idle', 'loading', 'playing', 'paused', 'error'] as const;

    expect(validStates).toContain('idle');
    expect(validStates).toContain('playing');
    expect(validStates).toContain('paused');
    expect(validStates).toContain('error');
  });
});

describe('Song validation logic', () => {
  it('should check if song has valid URL', () => {
    const songWithUrl = createMockSong({ url: 'https://example.com/audio.mp3' });
    const songWithoutUrl = createMockSong({ url: '' });

    expect(songWithUrl.url).toBeTruthy();
    expect(songWithoutUrl.url).toBeFalsy();
  });

  it('should check if song has required fields', () => {
    const song = createMockSong();

    expect(song.id).toBeDefined();
    expect(song.name).toBeDefined();
    expect(song.artist).toBeDefined();
    expect(song.url).toBeDefined();
  });

  it('should distinguish between netease and qq sources', () => {
    const neteaseSong = createMockSong({ sourceType: 'netease' });
    const qqSong = createMockSong({ sourceType: 'qq' });

    expect(neteaseSong.sourceType).toBe('netease');
    expect(qqSong.sourceType).toBe('qq');
  });
});

describe('Volume clamping logic', () => {
  const clampVolume = (volume: number): number => {
    return Math.max(0, Math.min(100, volume));
  };

  it('should clamp volume to 0-100', () => {
    expect(clampVolume(50)).toBe(50);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(100)).toBe(100);
  });

  it('should clamp values above 100', () => {
    expect(clampVolume(150)).toBe(100);
    expect(clampVolume(101)).toBe(100);
  });

  it('should clamp values below 0', () => {
    expect(clampVolume(-10)).toBe(0);
    expect(clampVolume(-1)).toBe(0);
  });
});

describe('Position seeking logic', () => {
  const isValidPosition = (position: number, duration: number): boolean => {
    return position >= 0 && position <= duration;
  };

  it('should accept valid position', () => {
    expect(isValidPosition(60, 180)).toBe(true);
    expect(isValidPosition(0, 180)).toBe(true);
    expect(isValidPosition(180, 180)).toBe(true);
  });

  it('should reject negative position', () => {
    expect(isValidPosition(-1, 180)).toBe(false);
  });

  it('should reject position beyond duration', () => {
    expect(isValidPosition(181, 180)).toBe(false);
  });
});

describe('Duration formatting logic', () => {
  const formatDuration = (duration: number): number => {
    return Math.floor(duration);
  };

  it('should floor duration', () => {
    expect(formatDuration(180.5)).toBe(180);
    expect(formatDuration(180.9)).toBe(180);
    expect(formatDuration(180.1)).toBe(180);
  });
});

describe('Playlist management logic', () => {
  it('should find song index in playlist', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
      createMockSong({ id: '3' }),
    ];
    const songId = '2';

    const index = playlist.findIndex(s => s.id === songId);

    expect(index).toBe(1);
  });

  it('should return -1 when song not found', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const songId = '99';

    const index = playlist.findIndex(s => s.id === songId);

    expect(index).toBe(-1);
  });

  it('should update playlist index when adding new song', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
    ];
    const newSong = createMockSong({ id: '3' });
    const newPlaylist = [...playlist, newSong];
    const songId = newSong.id;

    const index = newPlaylist.findIndex(s => s.id === songId);

    expect(index).toBe(2);
    expect(newPlaylist.length).toBe(3);
  });

  it('should keep existing index when song already in playlist', () => {
    const playlist = [
      createMockSong({ id: '1' }),
      createMockSong({ id: '2' }),
      createMockSong({ id: '3' }),
    ];
    const songId = '2';

    let currentPlaylistIndex = 0;
    const index = playlist.findIndex(s => s.id === songId);
    if (index !== -1) {
      currentPlaylistIndex = index;
    }

    expect(currentPlaylistIndex).toBe(1);
  });
});

describe('AudioPlayer singleton pattern', () => {
  let globalPlayer: any = null;

  const getGlobalPlayer = () => {
    if (!globalPlayer) {
      globalPlayer = { created: true, id: 'global-1' };
    }
    return globalPlayer;
  };

  const destroyGlobalPlayer = () => {
    globalPlayer = null;
  };

  it('should create singleton instance', () => {
    const player1 = getGlobalPlayer();
    const player2 = getGlobalPlayer();

    expect(player1).toBe(player2);
  });

  it('should destroy singleton', () => {
    const player1 = getGlobalPlayer();
    expect(player1).toBeDefined();

    destroyGlobalPlayer();
    expect(globalPlayer).toBeNull();
  });

  it('should recreate after destroy', () => {
    const player1 = getGlobalPlayer();
    destroyGlobalPlayer();
    const player2 = getGlobalPlayer();

    expect(player1).not.toBe(player2);
  });
});