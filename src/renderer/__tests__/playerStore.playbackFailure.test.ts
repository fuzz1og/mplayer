import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPrefetchCache, clearSkipGuard, getFailureStreak, getPrefetchedUrl, registerTerminalFailure, SKIP_LIMIT, type Song } from '@mplayer/core';
import { message } from 'antd';

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
    load: vi.fn(async (_song?: Song) => {}),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    destroy: vi.fn(),
  };
  return { player };
});

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

vi.mock('../services/callMusicApi', () => ({ callMusicApi: callMusicApiMock }));
vi.mock('../services/IpcClient', () => ({ IpcClient: { invoke: ipcInvokeMock } }));
vi.mock('../utils/songCoverRefresh', () => ({ refreshSongCover: vi.fn(async () => null) }));

import { usePlayerStore } from '../store/playerStore';

function song(id: string, name: string, url = ''): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType: 'netease', url, cover: '', lrc: '' };
}

/** 每首歌都解析出自己的直链 */
function resolveOkPerSong(): void {
  callMusicApiMock.mockImplementation(async (method: string, target?: Song) => {
    if (method === 'resolvePlayableSongRouted') {
      return { url: 'https://resolved.example.com/' + target?.id + '.mp3', nonFull: false };
    }
    if (method === 'searchSongsRouted') return [];
    return undefined;
  });
}

function stateWith(playlist: Song[], index = 0): void {
  usePlayerStore.setState({
    currentSong: playlist[index] ?? null,
    currentPlaylist: playlist,
    currentPlaylistIndex: playlist.length ? index : -1,
    isPlaying: false,
    isLoading: false,
    error: null,
    lyrics: '',
    lyricsLoading: false,
    playMode: '列表循环',
  });
}

function loadCallIds(): string[] {
  return audioPlayerMock.player.load.mock.calls.map((c) => (c[0] as Song | undefined)?.id ?? '');
}

beforeEach(() => {
  clearPrefetchCache();
  // #385：护栏状态是模块级会话状态，必须逐用例归零（否则计数/坏歌记忆跨用例泄漏）
  clearSkipGuard();
  localStorage.setItem('autoSkipOnError', 'true');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  stateWith([]);
  audioPlayerMock.player.load.mockReset();
  audioPlayerMock.player.load.mockImplementation(async (_song?: Song) => {});
  audioPlayerMock.player.play.mockClear();
  audioPlayerMock.player.stop.mockClear();
  audioPlayerMock.player.cancelLoad.mockClear();
  ipcInvokeMock.mockReset();
  ipcInvokeMock.mockResolvedValue(undefined);
  callMusicApiMock.mockReset();
  resolveOkPerSong();
});

describe('播放失败：fresh 重试与自动跳歌（对齐移动端语义）', () => {
  it('解析链全挂：同曲只 fresh 重试一次，仍失败自动跳下一首', async () => {
    callMusicApiMock.mockImplementation(async (method: string, target?: Song) => {
      if (method === 'resolvePlayableSongRouted') {
        if (target?.id === 'dead-1') throw new Error('请求超时');
        return { url: 'https://resolved.example.com/' + target?.id + '.mp3', nonFull: false };
      }
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });
    const a = song('dead-1', '晴天');
    const b = song('dead-2', '稻香');
    const filler = song('dead-3', '七里香');
    // 第三首让「跳歌成功后」的预取目标是 filler，而不是回绕到 dead-1（计入解析次数）
    stateWith([a, b, filler]);

    await usePlayerStore.getState().play(a);

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(audioPlayerMock.player.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dead-2' }),
    );
    // 失败曲只重试一次（原解析 + fresh 重试 = 2 次），不会无限重试
    const deadResolves = callMusicApiMock.mock.calls.filter(
      (c) => c[0] === 'resolvePlayableSongRouted' && (c[1] as Song | undefined)?.id === 'dead-1',
    );
    expect(deadResolves).toHaveLength(2);
  });

  it('音频加载失败（死链）：fresh 重试仍失败 → 自动跳下一首', async () => {
    audioPlayerMock.player.load.mockImplementation(async (target?: Song) => {
      if (target?.id === 'e-1') throw new Error('加载失败: 死链');
    });
    const a = song('e-1', '晴天');
    const b = song('e-2', '稻香');
    const c = song('e-3', '七里香');
    stateWith([a, b, c]);

    await usePlayerStore.getState().play(a);

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    // 死链曲重试一次（load 两次）；跳到的下一首只 load 一次
    const ids = loadCallIds();
    expect(ids.filter((id) => id === 'e-1')).toHaveLength(2);
    expect(ids.filter((id) => id === 'e-2')).toHaveLength(1);
  });

  it('播放成功后簿记异常（IPC 未就绪）不触发重试/跳歌', async () => {
    // IpcClient.invoke 返回 undefined → 历史写入的 .catch 链会抛 TypeError
    ipcInvokeMock.mockReset();
    ipcInvokeMock.mockReturnValue(undefined as unknown as Promise<void>);
    const a = song('post-1', '晴天');
    const b = song('post-2', '稻香');
    stateWith([a, b]);

    await usePlayerStore.getState().play(a);

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().error).toBeNull();
    // 不因簿记异常重试同一首：post-1 只解析一次
    const resolves = callMusicApiMock.mock.calls.filter(
      (c) => c[0] === 'resolvePlayableSongRouted' && (c[1] as Song | undefined)?.id === 'post-1',
    );
    expect(resolves).toHaveLength(1);
  });

  it('连续失败达固定上限 → 停止并报错，不死循环连跳（与队列长度无关）', async () => {
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') throw new Error('请求超时');
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });
    const songs = [song('x-1', 'A'), song('x-2', 'B'), song('x-3', 'C')];
    stateWith(songs);

    await usePlayerStore.getState().play(songs[0]);

    // 每首最多试 2 次（原解析 + fresh 重试）；上限 = 固定 SKIP_LIMIT 首 → 6 次后停
    const resolves = callMusicApiMock.mock.calls.filter((c) => c[0] === 'resolvePlayableSongRouted');
    expect(resolves).toHaveLength(SKIP_LIMIT * 2);
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().error).toBeTruthy();
  });

  it('离线：不进解析链，立即停止并明确告知（#385 D3）', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const errSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
    const a = song('off-1', '晴天');
    stateWith([a, song('off-2', '稻香')], 0);

    await usePlayerStore.getState().play(a);

    // 一次解析都不发：直连 3s 墙与 tier3 6s 全部省掉
    expect(callMusicApiMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('离线'));
    errSpy.mockRestore();
  });

  it('关闭「失败即跳」：失败即停，不改写用户意图（#385 D6）', async () => {
    localStorage.setItem('autoSkipOnError', 'false');
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') throw new Error('请求超时');
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });
    const errSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
    const a = song('as-1', '晴天');
    const b = song('as-2', '稻香');
    stateWith([a, b], 0);

    await usePlayerStore.getState().play(a);

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0); // 不跳
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('自动跳歌已关闭'));
    errSpy.mockRestore();
  });

  it('会话内已证明失效的歌不再被跳歌选中（#385 D4）', async () => {
    const a = song('bad-a', '晴天');
    const b = song('bad-b', '稻香');
    const c = song('bad-c', '七里香');
    registerTerminalFailure(b); // b 已在本会话被证明失效
    callMusicApiMock.mockImplementation(async (method: string, target?: Song) => {
      if (method === 'resolvePlayableSongRouted') {
        if (target?.id === 'bad-a') throw new Error('请求超时');
        return { url: 'https://resolved.example.com/' + target?.id + '.mp3', nonFull: false };
      }
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });
    stateWith([a, b, c], 0);

    await usePlayerStore.getState().play(a);

    // 跳过坏歌 b，直接落在 c
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(2);
    expect(loadCallIds()).toContain('bad-c');
    expect(loadCallIds()).not.toContain('bad-b');
  });

  it('成功播放后连续失败计数归零（手动点歌不清零，只有真正出声才清零）', async () => {
    registerTerminalFailure(song('z-1', '晴天'));
    expect(getFailureStreak()).toBe(1);
    const ok = song('ok-1', '稻香');
    stateWith([ok], 0);

    await usePlayerStore.getState().play(ok);

    expect(getFailureStreak()).toBe(0);
  });

  it('本地文件失败：不做 fresh 重试，直接跳下一首', async () => {
    const localSong: Song = { ...song('local-1', '本地demo'), sourceType: 'local', url: '' };
    const next = song('n-1', '稻香');
    stateWith([localSong, next]);

    await usePlayerStore.getState().play(localSong);

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1);
    expect(callMusicApiMock).not.toHaveBeenCalledWith(
      'resolvePlayableSongRouted',
      expect.objectContaining({ id: 'local-1' }),
    );
    expect(audioPlayerMock.player.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-1' }),
    );
  });

  it('队列只有这一首且失败 → 停止并提示，不自我循环（单曲循环同理）', async () => {
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') throw new Error('请求超时');
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });
    const only = song('solo-1', '晴天');
    stateWith([only]);
    usePlayerStore.setState({ playMode: '单曲循环' });

    await usePlayerStore.getState().play(only);

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().error).toBeTruthy();
    // 单曲循环下不得反复自我重播：只试 2 次（原解析 + fresh）
    const resolves = callMusicApiMock.mock.calls.filter((c) => c[0] === 'resolvePlayableSongRouted');
    expect(resolves).toHaveLength(2);
  });
});

describe('预取必须落到读路径那一份缓存（#390）', () => {
  it('下一首预取经 IPC 门面（prefetchPlayableSong），渲染层不再自写本地缓存', async () => {
    const a = song('pf-1', '晴天');
    const b = song('pf-2', '稻香');
    stateWith([a, b]);

    await usePlayerStore.getState().play(a);

    await vi.waitFor(() => {
      expect(callMusicApiMock).toHaveBeenCalledWith(
        'prefetchPlayableSong',
        expect.objectContaining({ id: 'pf-2' }),
      );
    });
    // 关键回归断言：渲染层那份 prefetchCache 恒空——播放解析经 IPC 读的是主进程那份，
    // 自写本地缓存等于空转（原实现正是如此，#390）。
    expect(getPrefetchedUrl(b)).toBeUndefined();
  });

  it('fresh 重试前经 IPC 遗忘主进程那份预取直链（不再无限复用坏地址）', async () => {
    const a = song('pf-3', '晴天');
    const b = song('pf-4', '稻香');
    stateWith([a, b]);
    await usePlayerStore.getState().play(a);
    await vi.waitFor(() =>
      expect(callMusicApiMock).toHaveBeenCalledWith(
        'prefetchPlayableSong',
        expect.objectContaining({ id: 'pf-4' }),
      ),
    );

    // b 解析失败 → fresh 重试必须先忘掉这条预取直链
    callMusicApiMock.mockClear();
    callMusicApiMock.mockImplementation(async (method: string) => {
      if (method === 'resolvePlayableSongRouted') throw new Error('请求超时');
      if (method === 'searchSongsRouted') return [];
      return undefined;
    });
    await usePlayerStore.getState().play(b);

    expect(callMusicApiMock).toHaveBeenCalledWith(
      'forgetPrefetchedSong',
      expect.objectContaining({ id: 'pf-4' }),
    );
  });
});
