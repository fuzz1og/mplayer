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

// #608：取词决策单点守卫——默认透传 core 真实现，个别用例投毒成固定 plan
const planLyricsFetchMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('@mplayer/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mplayer/core')>();
  planLyricsFetchMock.fn.mockImplementation(actual.planLyricsFetch);
  return {
    ...actual,
    planLyricsFetch: (s: Parameters<typeof actual.planLyricsFetch>[0]) => planLyricsFetchMock.fn(s),
  };
});

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
      // #544：解析入口必须给答案，否则 play() 在解析步就返回、走不到取词
      if (method === 'resolvePlayableSongRouted') return { url: 'https://audio.example.com/1.mp3', nonFull: false };
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

  it('搜索候选里没有精确匹配 → 不采用第一名的歌词（防翻唱误配）', async () => {
    // qq 不是 songid 直取源（网易/汽水才跳过搜索补全），所以这条走的是搜索补全路径。
    const s1 = { ...song('1'), sourceType: 'qq' as Song['sourceType'] };
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'searchSongsRouted') return searchSongsMock();
      if (method === 'resolvePlayableSongRouted') return { url: s1.url, nonFull: false };
      // 旧实现会把翻唱候选的 lrc URL 当成本歌的歌词并取回——正是这条路径要挡住的。
      if (method === 'getLyrics') return '翻唱歌词';
      return undefined;
    });
    // 候选里只有同名**不同歌手**的翻唱（非精确匹配），它带着歌词 URL——
    // 旧实现 `(hit || results[0])?.lrc` 会把这条 URL 当成本歌的歌词。
    searchSongsMock.mockResolvedValue([
      { ...s1, id: 'qq:cover', artist: '某翻唱', lrc: FRESH_LRC },
    ]);

    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });
    await usePlayerStore.getState().play(s1);

    await vi.waitFor(() => expect(usePlayerStore.getState().lyricsLoading).toBe(false), { timeout: 3000 });
    expect(usePlayerStore.getState().lyrics).toBe('');
    expect(callMusicApiMock).not.toHaveBeenCalledWith('getLyrics', FRESH_LRC);
  });

  it('重搜仍拿不到歌词 URL 时不再重试，歌词为空', async () => {
    const s1 = { ...song('1'), lrc: STALE_LRC };
    // searchSongsMock 默认返回 []（beforeEach 已设）：搜不到 → 重搜仍拿不到 lrc
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'searchSongsRouted') return searchSongsMock();
      if (method === 'resolvePlayableSongRouted') return { url: 'https://audio.example.com/1.mp3', nonFull: false };
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
describe('网易歌词按需直取（#409：列表不再内联，播放期按 songId 取）', () => {
  it('lrc 为空的网易歌 → 走 getNeteaseLyrics，且不再触发搜索补全', async () => {
    const s1 = song('1'); // lrc: '' —— #409 之后列表结果就是这个形态
    callMusicApiMock.mockImplementation(async (method: string) => {
      // 播放解析腿（与歌词无关）也必须给答案，否则 play() 会先失败、走不到取词
      if (method === 'resolvePlayableSongRouted') return { url: s1.url, nonFull: false };
      if (method === 'getNeteaseLyrics') return LYRICS_TEXT;
      return undefined;
    });

    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });
    await usePlayerStore.getState().play(s1);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().lyrics).toBe(LYRICS_TEXT);
    }, { timeout: 3000 });

    const methods = callMusicApiMock.mock.calls.map((c) => c[0]);
    expect(callMusicApiMock).toHaveBeenCalledWith('getNeteaseLyrics', '1');
    // 关键：songid 直取源跳过搜索补全——否则「列表省下的请求」会从播放路径漏回来
    expect(methods).not.toContain('searchSongsRouted');
  });

  it('存量数据的内联 LRC 文本仍直接使用（零请求）', async () => {
    const s1 = { ...song('1'), lrc: '[00:00.00]存量内联歌词' };
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') return { url: s1.url, nonFull: false };
      return undefined;
    });
    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });
    await usePlayerStore.getState().play(s1);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().lyrics).toBe('[00:00.00]存量内联歌词');
    }, { timeout: 3000 });

    const methods = callMusicApiMock.mock.calls.map((c) => c[0]);
    expect(methods).not.toContain('getNeteaseLyrics');
    expect(methods).not.toContain('getLyrics');
  });
});

describe('歌词取词决策单一来源 core planLyricsFetch（#608）', () => {
  it('⭐ 计划给 inline 就零请求直用计划文本（不再自判源 / 自行搜索补全）', async () => {
    planLyricsFetchMock.fn.mockReturnValueOnce({ kind: 'inline', text: '[00:00.00]计划注入' });
    // qq + lrc 空：旧实现会走搜索补全；计划已定 inline，就必须零请求
    const s1 = { ...song('1'), sourceType: 'qq' as Song['sourceType'], lrc: '' };
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') return { url: s1.url, nonFull: false };
      if (method === 'getLyrics') return '不该被取回的歌词';
      return undefined;
    });
    searchSongsMock.mockResolvedValue([{ ...s1, lrc: FRESH_LRC }]);

    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });
    await usePlayerStore.getState().play(s1);

    await vi.waitFor(() => {
      expect(usePlayerStore.getState().lyrics).toBe('[00:00.00]计划注入');
    }, { timeout: 3000 });

    expect(searchSongsMock).not.toHaveBeenCalled();
    expect(callMusicApiMock).not.toHaveBeenCalledWith('getLyrics', expect.anything());
  });
});
