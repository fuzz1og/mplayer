import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPrefetchCache, forgetPrefetchedUrl, getPrefetchedUrl, setPrefetchedUrl, type Song } from '@mplayer/core';

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

vi.mock('../services/audioPlayer', () => ({
  getGlobalPlayer: () => audioPlayerMock.player,
  destroyGlobalPlayer: vi.fn(),
}));

const callMusicApiMock = vi.hoisted(() => vi.fn());
vi.mock('../services/callMusicApi', () => ({ callMusicApi: callMusicApiMock }));
vi.mock('../services/IpcClient', () => ({ IpcClient: { invoke: vi.fn(async () => undefined) } }));
vi.mock('../utils/songCoverRefresh', () => ({ refreshSongCover: vi.fn(async () => null) }));

import { usePlayerStore, warmupRestoredSong } from '../store/playerStore';

function song(id: string, name = '晴天'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: '', cover: '', lrc: '',
  };
}

/** core 契约同口径：先查预取缓存，命中 0 等待返回 */
function resolveRouted(target?: Song) {
  const prefetched = target ? getPrefetchedUrl(target) : undefined;
  return prefetched ?? { url: 'https://resolved.example.com/audio.mp3', nonFull: false };
}

function defaultCallMusicApi(): void {
  callMusicApiMock.mockImplementation(async (method: string, target?: Song) => {
    switch (method) {
      case 'resolvePlayableSongRouted':
        return resolveRouted(target);
      // #390：预取经门面在主进程执行——测试模拟「解析 + 写入读路径那份缓存」
      case 'prefetchPlayableSong': {
        const existing = target ? getPrefetchedUrl(target) : undefined;
        if (existing) return existing;
        const resolved = resolveRouted(target);
        if (target && resolved?.url) setPrefetchedUrl(target, resolved.url, !!resolved.nonFull);
        return resolved;
      }
      case 'forgetPrefetchedSong':
        if (target) forgetPrefetchedUrl(target);
        return undefined;
      case 'resolvePlayableUrlRouted':
        return 'https://resolved.example.com/audio.mp3';
      case 'searchSongsRouted':
        return [];
      case 'getSodaPlayableUrl':
        return '';
      default:
        return undefined;
    }
  });
}

/** 让 resume() 内部 fire-and-forget 的 play() 链落定 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  clearPrefetchCache();
  audioPlayerMock.player.getState.mockReturnValue('idle');
  audioPlayerMock.player.getCurrentSong.mockReturnValue(null);
  audioPlayerMock.player.load.mockClear();
  audioPlayerMock.player.play.mockClear();
  audioPlayerMock.player.cancelLoad.mockClear();
  callMusicApiMock.mockReset();
  defaultCallMusicApi();
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    error: null,
    lyrics: '',
    lyricsLoading: false,
    currentPlaylist: [],
    currentPlaylistIndex: -1,
  });
});

// ---------------------------------------------------------------------------
// #328：冷启还原态点播放必须真的出声
//
// 冷启时队列从 localStorage 还原（currentSong 有值、isPlaying=false），
// 但传输层没有 Howl（state='idle'）。旧实现 resume() 直接
// audioPlayer.play()（内部 howl 守卫 → 静默空操作）并置 isPlaying=true，
// 结果：不出声 + 声波动画空转 + 进度条说谎。
// ---------------------------------------------------------------------------
describe('冷启还原态：resume 必须重走全链解析（#328）', () => {
  it('传输层 idle 时，resume 走 play() 全链解析并从头播，而非空操作', async () => {
    const restored = song('1');
    usePlayerStore.setState({
      currentSong: restored,
      currentPlaylist: [restored],
      currentPlaylistIndex: 0,
    });

    usePlayerStore.getState().resume();
    await flush();

    // 真的发起了解析与加载（旧实现在这一步什么都没有）
    expect(callMusicApiMock).toHaveBeenCalledWith('resolvePlayableSongRouted', expect.objectContaining({ id: '1' }));
    expect(audioPlayerMock.player.load).toHaveBeenCalledTimes(1);
    expect(audioPlayerMock.player.load.mock.calls[0][0]).toMatchObject({
      url: 'https://resolved.example.com/audio.mp3',
    });
    expect(audioPlayerMock.player.play).toHaveBeenCalledTimes(1);
  });

  it('resume 兑现后 isPlaying 为 true 且没有 error（状态诚实）', async () => {
    const restored = song('1');
    usePlayerStore.setState({ currentSong: restored, currentPlaylist: [restored], currentPlaylistIndex: 0 });

    usePlayerStore.getState().resume();
    await flush();

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().error).toBeNull();
    expect(usePlayerStore.getState().isLoading).toBe(false);
  });

  it('togglePlay 在冷启还原态同样重走全链解析（5 个入口共用同一分支）', async () => {
    const restored = song('1');
    usePlayerStore.setState({ currentSong: restored, currentPlaylist: [restored], currentPlaylistIndex: 0 });

    usePlayerStore.getState().togglePlay();
    await flush();

    expect(callMusicApiMock).toHaveBeenCalledWith('resolvePlayableSongRouted', expect.objectContaining({ id: '1' }));
    expect(audioPlayerMock.player.load).toHaveBeenCalledTimes(1);
  });

  it('传输层已有音频（正常暂停）时，resume 只 play()，不重新解析', async () => {
    const paused = song('1');
    // 传输层持有这首歌且已暂停 —— 正常暂停态
    audioPlayerMock.player.getState.mockReturnValue('paused');
    audioPlayerMock.player.getCurrentSong.mockReturnValue(paused);
    usePlayerStore.setState({ currentSong: paused, currentPlaylist: [paused], currentPlaylistIndex: 0 });

    usePlayerStore.getState().resume();
    await flush();

    expect(callMusicApiMock).not.toHaveBeenCalled();
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
    expect(audioPlayerMock.player.play).toHaveBeenCalledTimes(1);
  });

  it('上次加载失败（error）时，resume 遗忘坏预取条目并 fresh 重解析', async () => {
    const failed = song('1');
    audioPlayerMock.player.getState.mockReturnValue('error');
    // 预取缓存里是一条已被证明失败的直链
    const { setPrefetchedUrl } = await import('@mplayer/core');
    setPrefetchedUrl(failed, 'https://stale.example.com/dead.mp3', false);

    usePlayerStore.setState({ currentSong: failed, currentPlaylist: [failed], currentPlaylistIndex: 0 });
    usePlayerStore.getState().resume();
    await flush();

    // fresh 语义：坏条目被遗忘，重新解析拿到新 URL（不再命中坏直链）
    expect(audioPlayerMock.player.load.mock.calls[0][0]).toMatchObject({
      url: 'https://resolved.example.com/audio.mp3',
    });
    expect(audioPlayerMock.player.play).toHaveBeenCalledTimes(1);
  });

  it('无 currentSong 时 resume 不做任何事（不谎报 isPlaying）', () => {
    usePlayerStore.setState({ currentSong: null, isPlaying: false });

    usePlayerStore.getState().resume();

    expect(audioPlayerMock.player.play).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #328：冷启预热 —— 让首次点播放命中预取缓存 0 等待
// ---------------------------------------------------------------------------
describe('冷启预热 warmupRestoredSong（#328 / #390）', () => {
  it('经 IPC 门面预热还原的当前歌（写入主进程读路径）', async () => {
    const restored = song('1');
    usePlayerStore.setState({ currentSong: restored, currentPlaylist: [restored], currentPlaylistIndex: 0 });

    warmupRestoredSong();
    await flush();

    expect(callMusicApiMock).toHaveBeenCalledWith('prefetchPlayableSong', expect.objectContaining({ id: '1' }));
    expect(getPrefetchedUrl(restored)?.url).toBe('https://resolved.example.com/audio.mp3');
  });

  it('覆盖面扩到「当前歌 + 队列下一首」（限 2 首）', async () => {
    const restored = song('1');
    const next = song('2');
    const third = song('3');
    usePlayerStore.setState({
      currentSong: restored,
      currentPlaylist: [restored, next, third],
      currentPlaylistIndex: 0,
    });

    warmupRestoredSong();
    await flush();

    expect(callMusicApiMock).toHaveBeenCalledWith('prefetchPlayableSong', expect.objectContaining({ id: '1' }));
    expect(callMusicApiMock).toHaveBeenCalledWith('prefetchPlayableSong', expect.objectContaining({ id: '2' }));
    expect(callMusicApiMock).not.toHaveBeenCalledWith('prefetchPlayableSong', expect.objectContaining({ id: '3' }));
  });

  it('已有预取条目时只委派一次（去重下沉到 core，渲染层读不到主进程缓存）', async () => {
    const restored = song('1');
    setPrefetchedUrl(restored, 'https://warm.example.com/a.mp3', false);
    usePlayerStore.setState({ currentSong: restored, currentPlaylist: [restored], currentPlaylistIndex: 0 });

    warmupRestoredSong();
    await flush();

    const prefetchCalls = callMusicApiMock.mock.calls.filter((c) => c[0] === 'prefetchPlayableSong');
    expect(prefetchCalls).toHaveLength(1);
  });

  it('无还原歌曲或本地歌曲时不发请求', async () => {
    usePlayerStore.setState({ currentSong: null });
    warmupRestoredSong();
    await flush();
    expect(callMusicApiMock).not.toHaveBeenCalled();

    const local = { ...song('9'), sourceType: 'local' as const, url: 'file:///a.mp3' };
    usePlayerStore.setState({ currentSong: local });
    warmupRestoredSong();
    await flush();
    expect(callMusicApiMock).not.toHaveBeenCalled();
  });

  it('解析失败静默（真正播放时再走正常失败链）', async () => {
    callMusicApiMock.mockRejectedValue(new Error('直连不可用'));
    const restored = song('1');
    usePlayerStore.setState({ currentSong: restored, currentPlaylist: [restored], currentPlaylistIndex: 0 });

    expect(() => warmupRestoredSong()).not.toThrow();
    await flush();

    expect(getPrefetchedUrl(restored)).toBeUndefined();
  });
});
