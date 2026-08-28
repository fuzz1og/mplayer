import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@mplayer/core';

// --- Mock 准备：audioPlayer / callMusicApi / IpcClient / songCoverRefresh ---
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

// 捕获 getGlobalPlayer 传入的回调（onLoadError/onEnd），测试中可定向触发
const capturedCallbacks: { current: Record<string, unknown> } = vi.hoisted(() => ({ current: {} }));

vi.mock('../services/audioPlayer', () => ({
  getGlobalPlayer: (callbacks: Record<string, unknown>) => {
    capturedCallbacks.current = callbacks || {};
    return audioPlayerMock.player;
  },
  destroyGlobalPlayer: vi.fn(),
}));

const callMusicApiMock = vi.hoisted(() => vi.fn());
const ipcInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('../services/callMusicApi', () => ({
  callMusicApi: callMusicApiMock,
}));

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: ipcInvokeMock },
}));

vi.mock('../utils/songCoverRefresh', () => ({
  refreshSongCover: vi.fn(async () => null),
}));

import { usePlayerStore, __clearPrefetchedUrlsForTests } from '../store/playerStore';

function song(id: string, name = '晴天', url = ''): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url, cover: '', lrc: '',
  };
}

/** 默认 callMusicApi 分发：getAudioUrl 返回可用 URL，搜索/换源返回空 */
function defaultCallMusicApi(): void {
  callMusicApiMock.mockImplementation(async (method: string) => {
    switch (method) {
      case 'getAudioUrl':
        return 'https://resolved.example.com/audio.mp3';
      case 'resolvePlayableUrlRouted':
        return 'https://resolved.example.com/audio.mp3';
      case 'resolvePlayableSongRouted':
        return { url: 'https://resolved.example.com/audio.mp3', nonFull: false };
      case 'getSodaPlayableUrl':
        return '';
      case 'searchSongsRouted':
        return [];
      case 'searchSongById':
        return null;
      default:
        return undefined;
    }
  });
}

beforeEach(() => {
  __clearPrefetchedUrlsForTests();
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    error: null,
    lyrics: '',
    lyricsLoading: false,
    currentPlaylist: [],
    currentPlaylistIndex: -1,
  });
  audioPlayerMock.player.load.mockClear();
  audioPlayerMock.player.play.mockClear();
  audioPlayerMock.player.seek.mockClear();
  audioPlayerMock.player.stop.mockClear();
  audioPlayerMock.player.cancelLoad.mockClear();
  ipcInvokeMock.mockReset();
  ipcInvokeMock.mockResolvedValue(undefined);
  callMusicApiMock.mockReset();
  defaultCallMusicApi();
});

// ---------------------------------------------------------------------------
// 队列推进：playNext / playPrevious 收敛到 core getNextSongIndex / getPrevSongIndex
// ---------------------------------------------------------------------------
describe('playNext（core getNextSongIndex 收敛）', () => {
  it('单曲循环：刻意走 seek(0)+play 特例，不触发 load/play 主链路（避免 reload）', () => {
    const s1 = song('netease:1', '晴天', 'https://audio.example.com/1.mp3');
    usePlayerStore.setState({
      currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1, playMode: '单曲循环',
    });

    usePlayerStore.getState().playNext();

    expect(audioPlayerMock.player.seek).toHaveBeenCalledWith(0);
    expect(audioPlayerMock.player.play).toHaveBeenCalled();
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
  });

  it('列表循环：最后一首回绕到第一首并加载播放', async () => {
    const songs = [
      song('netease:1', '晴天', 'https://audio.example.com/1.mp3'),
      song('netease:2', '稻香', 'https://audio.example.com/2.mp3'),
      song('netease:3', '七里香', 'https://audio.example.com/3.mp3'),
    ];
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 2, currentSong: songs[2], playMode: '列表循环',
    });

    usePlayerStore.getState().playNext();
    await vi.waitFor(() => expect(audioPlayerMock.player.load).toHaveBeenCalled());

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
    expect(audioPlayerMock.player.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'netease:1' }),
    );
  });

  it('随机播放：防重复，选中 index 不等于当前（范围合法）', async () => {
    const songs = [
      song('netease:1', '晴天', 'https://audio.example.com/1.mp3'),
      song('netease:2', '稻香', 'https://audio.example.com/2.mp3'),
      song('netease:3', '七里香', 'https://audio.example.com/3.mp3'),
    ];
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 1, currentSong: songs[1], playMode: '随机播放',
    });

    usePlayerStore.getState().playNext();

    const idx = usePlayerStore.getState().currentPlaylistIndex;
    expect(idx).not.toBe(1);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(3);
  });

  it('空队列 / index -1：自写 index 回绕前直接 stop', () => {
    usePlayerStore.setState({ currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null });

    usePlayerStore.getState().playNext();

    expect(audioPlayerMock.player.stop).toHaveBeenCalled();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(-1);
  });
});

describe('playPrevious（core getPrevSongIndex 收敛）', () => {
  it('列表循环：index 0 回绕到最后一首并加载播放', async () => {
    const songs = [
      song('netease:1', '晴天', 'https://audio.example.com/1.mp3'),
      song('netease:2', '稻香', 'https://audio.example.com/2.mp3'),
      song('netease:3', '七里香', 'https://audio.example.com/3.mp3'),
    ];
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 0, currentSong: songs[0], playMode: '列表循环',
    });

    usePlayerStore.getState().playPrevious();
    await vi.waitFor(() => expect(audioPlayerMock.player.load).toHaveBeenCalled());

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(songs.length - 1);
  });

  it('随机播放：防重复，选中 index 不等于当前', () => {
    const songs = [
      song('netease:1', '晴天', 'https://audio.example.com/1.mp3'),
      song('netease:2', '稻香', 'https://audio.example.com/2.mp3'),
      song('netease:3', '七里香', 'https://audio.example.com/3.mp3'),
    ];
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 1, currentSong: songs[1], playMode: '随机播放',
    });

    usePlayerStore.getState().playPrevious();

    const idx = usePlayerStore.getState().currentPlaylistIndex;
    expect(idx).not.toBe(1);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// 播放链路固化
// ---------------------------------------------------------------------------
describe('播放链路：URL 解析 / 加载失败', () => {
  it('无 url 歌曲：按歌手名搜索解析 url 后加载（兜底）', async () => {
    const s1 = song('netease:1', '晴天', ''); // url 为空
    const foundUrl = 'https://found.example.com/1.mp3';
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'getAudioUrl') return ''; // 无真实解析
      if (method === 'resolvePlayableUrlRouted') return ''; // 无真实解析
      if (method === 'resolvePlayableSongRouted') return { url: '', nonFull: false }; // 无真实解析
      if (method === 'searchSongsRouted') return [{ ...s1, url: foundUrl, lrc: '' }];
      if (method === 'getSodaPlayableUrl') return '';
      return undefined;
    });
    usePlayerStore.setState({ currentPlaylist: [s1], currentPlaylistIndex: 0, currentSong: s1 });

    await usePlayerStore.getState().play(s1);

    expect(callMusicApiMock).toHaveBeenCalledWith('searchSongsRouted', '晴天 周杰伦', 1, 'netease');
    expect(audioPlayerMock.player.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'netease:1', url: foundUrl }),
    );
  });

  it('加载失败：error 置位、isPlaying 停、不触发下一首（不跳歌）', async () => {
    const songs = [
      song('netease:1', '晴天', 'https://audio.example.com/1.mp3'),
      song('netease:2', '稻香', 'https://audio.example.com/2.mp3'),
    ];
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 0, currentSong: songs[0], isPlaying: true,
    });

    // 模拟音频播放器 load 失败（onLoadError）
    const onLoadError = capturedCallbacks.current.onLoadError as (error: Error) => void;
    onLoadError?.(new Error('加载音频失败: test'));

    expect(usePlayerStore.getState().error).toBe('加载音频失败: test');
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().isLoading).toBe(false);
    // 不跳歌：没有触发下一首的 load/play，index 不变
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
    expect(audioPlayerMock.player.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 队列下一首预取（#171 后列表歌 url 恒空：预取不得依赖 url；缓存键必须含歌曲 id）
// ---------------------------------------------------------------------------
describe('队列下一首预取（预取缓存键）', () => {
  function routedResolverPerSong(): void {
    callMusicApiMock.mockImplementation(async (method: string, target?: { id?: string }) => {
      if (method === 'resolvePlayableSongRouted') {
        const url = `https://resolved.example.com/${target?.id}.mp3`;
        return { url, nonFull: false };
      }
      return undefined;
    });
  }

  it('下一首即使 url 为空也触发预解析（#171 后搜索结果一律无 url）', async () => {
    routedResolverPerSong();
    const current = song('pf-a', '晴天');
    const next = song('pf-b', '稻香'); // url 为空
    usePlayerStore.setState({
      currentPlaylist: [current, next], currentPlaylistIndex: 0,
      currentSong: current, playMode: '列表循环',
    });

    await usePlayerStore.getState().play(current);
    await vi.waitFor(() =>
      expect(callMusicApiMock).toHaveBeenCalledWith(
        'resolvePlayableSongRouted',
        expect.objectContaining({ id: 'pf-b' }),
      ),
    );
  });

  it('不同歌曲互不串缓存：预取了下一首，手动播放第三首仍走自己的解析', async () => {
    routedResolverPerSong();
    const a = song('qc-a', '晴天');
    const b = song('qc-b', '稻香');
    const c = song('qc-c', '七里香');
    usePlayerStore.setState({
      currentPlaylist: [a, b, c], currentPlaylistIndex: 0,
      currentSong: a, playMode: '列表循环',
    });

    await usePlayerStore.getState().play(a);
    // 等预取把下一首（b）的解析结果写入缓存
    await vi.waitFor(() =>
      expect(callMusicApiMock).toHaveBeenCalledWith(
        'resolvePlayableSongRouted',
        expect.objectContaining({ id: 'qc-b' }),
      ),
    );

    // 用户手动点播第三首：不得命中 b 的预取结果
    await usePlayerStore.getState().play(c);

    expect(callMusicApiMock).toHaveBeenCalledWith(
      'resolvePlayableSongRouted',
      expect.objectContaining({ id: 'qc-c' }),
    );
    expect(audioPlayerMock.player.load).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'qc-c', url: 'https://resolved.example.com/qc-c.mp3' }),
    );
  });

  it('local 源下一首不预取', async () => {
    routedResolverPerSong();
    const current = song('pl-a', '晴天', 'https://audio.example.com/a.mp3');
    const localNext: Song = { ...song('pl-local', '本地demo'), sourceType: 'local', url: '/music/demo.mp3' };
    usePlayerStore.setState({
      currentPlaylist: [current, localNext], currentPlaylistIndex: 0,
      currentSong: current, playMode: '列表循环',
    });

    await usePlayerStore.getState().play(current);
    // 给 fire-and-forget 预取留出误触发的机会
    await new Promise((r) => setTimeout(r, 20));

    expect(callMusicApiMock).not.toHaveBeenCalledWith(
      'resolvePlayableSongRouted',
      expect.objectContaining({ id: 'pl-local' }),
    );
  });
});
