import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

const audioPlayerMock = vi.hoisted(() => {
  const player = {
    getVolume: vi.fn(() => 80),
    getPosition: vi.fn(() => 0),
    getDuration: vi.fn(() => 0),
    getState: vi.fn(() => 'idle'),
    getCurrentSong: vi.fn(() => null),
    isPlaying: vi.fn(() => false),
    isPaused: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    cancelLoad: vi.fn(),
    load: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    destroy: vi.fn(),
  };
  return { player };
});

const ipcInvokeMock = vi.hoisted(() => vi.fn());
const callMusicApiMock = vi.hoisted(() => vi.fn());
const searchSongsMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('../services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

// 歌词搜索补全走 callMusicApi('searchSongsRouted')，歌词获取走 callMusicApi('getLyrics')
vi.mock('../services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: ipcInvokeMock },
}));

vi.mock('../utils/songCoverRefresh', () => ({
  refreshSongCover: vi.fn(async () => null),
}));

import { usePlayerStore } from '../store/playerStore';

const STALE_LRC = 'https://api.example.com/api.php?get=lrc&id=1&sign=OLDSIGN&t=1';
const FRESH_LRC = 'https://api.example.com/api.php?get=lrc&id=1&sign=NEWSIGN&t=2';
const LYRICS_TEXT = '[00:00.00]歌词内容';

function song(id: string): Song {
  return {
    id, name: '晴天', artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: 'https://audio.example.com/1.mp3', cover: '', lrc: '',
  };
}

beforeEach(() => {
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    lyrics: '',
    lyricsLoading: false,
    currentPlaylist: [],
    currentPlaylistIndex: -1,
    error: null,
  });
  audioPlayerMock.player.load.mockClear();
  audioPlayerMock.player.play.mockClear();
  ipcInvokeMock.mockReset();
  callMusicApiMock.mockReset();
  searchSongsMock.mockReset();
  searchSongsMock.mockResolvedValue([]);
});

describe('歌词获取失败自动重试（会话失效 → 重搜新签名）', () => {
  it('lrc URL 失效时重搜新签名并成功加载歌词', async () => {
    const s1 = { ...song('1'), lrc: STALE_LRC };
    let lyricsGetCalls = 0;
    // callMusicApi 分发：searchSongsRouted → searchSongsMock（hoisted，测试注入）；getLyrics → 歌词实现
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'searchSongsRouted') return searchSongsMock();
      if (method === 'getLyrics') {
        lyricsGetCalls++;
        if (lyricsGetCalls === 1) throw new Error('歌词会话失效（非法请求）');
        return LYRICS_TEXT;
      }
      return undefined;
    });
    // 歌词搜索补全走 searchSongsMock（renderer 直调 callMusicApi，不再经 IpcClient.invoke）
    searchSongsMock.mockResolvedValue([{ ...s1, lrc: FRESH_LRC }]);

    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });
    await usePlayerStore.getState().play(s1);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().lyrics).toBe(LYRICS_TEXT);
    }, { timeout: 3000 });

    expect(lyricsGetCalls).toBe(2);
    expect(callMusicApiMock).toHaveBeenCalledWith('getLyrics', STALE_LRC);
    expect(callMusicApiMock).toHaveBeenCalledWith('getLyrics', FRESH_LRC);
  });

  it('重搜仍拿不到歌词 URL 时不再重试，歌词为空', async () => {
    const s1 = { ...song('1'), lrc: STALE_LRC };
    // searchSongsMock 默认返回 []（beforeEach 已设）：搜不到 → 重搜仍拿不到 lrc
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'searchSongsRouted') return searchSongsMock();
      if (method === 'getLyrics') throw new Error('歌词会话失效（非法请求）');
      return undefined;
    });

    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });
    await usePlayerStore.getState().play(s1);

    await new Promise((r) => setTimeout(r, 800));
    expect(usePlayerStore.getState().lyrics).toBe('');
    expect(usePlayerStore.getState().lyricsLoading).toBe(false);
  });
});
