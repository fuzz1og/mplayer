import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPrefetchCache, type Song } from '@mplayer/core';

// --- Mock 准备：与 playerStore.queue.test.ts 同款（audioPlayer / callMusicApi / IpcClient / songCoverRefresh）---
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

function song(id: string, name = '晴天'): Song {
  return {
    id, name, artist: '周杰伦', album: '', duration: 240,
    sourceType: 'netease', url: `https://audio.example.com/${id}.mp3`, cover: '', lrc: '',
  };
}

const ids = () => usePlayerStore.getState().currentPlaylist.map(s => s.id);

beforeEach(() => {
  clearPrefetchCache();
  localStorage.clear();
  usePlayerStore.setState({
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    error: null,
    lyrics: '',
    lyricsLoading: false,
    playMode: '列表循环',
    currentPlaylist: [],
    currentPlaylistIndex: -1,
  });
  audioPlayerMock.player.load.mockClear();
  audioPlayerMock.player.play.mockClear();
  audioPlayerMock.player.stop.mockClear();
  ipcInvokeMock.mockReset();
  ipcInvokeMock.mockResolvedValue(undefined);
  callMusicApiMock.mockReset();
  callMusicApiMock.mockImplementation(async (method: string) => {
    switch (method) {
      case 'resolvePlayableSongRouted':
        return { url: 'https://resolved.example.com/audio.mp3', nonFull: false };
      case 'resolvePlayableUrlRouted':
        return 'https://resolved.example.com/audio.mp3';
      default:
        return undefined;
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// #491 下一首播放：插入到当前曲之后；已在队列则移动（不复制）
// ---------------------------------------------------------------------------
describe('insertNext：插入到当前曲之后（#491）', () => {
  const seed = () => {
    const a = song('netease:1', 'A');
    const b = song('netease:2', 'B');
    const c = song('netease:3', 'C');
    const d = song('netease:4', 'D');
    usePlayerStore.setState({
      currentPlaylist: [a, b, c, d],
      currentPlaylistIndex: 1, // 当前 = B
      currentSong: b,
    });
    return { a, b, c, d };
  };

  it('不在队列的歌 → 插到当前曲之后，队列 +1，当前曲不被打断', async () => {
    const { b } = seed();
    const x = song('netease:9', 'X');

    await usePlayerStore.getState().insertNext(x);

    expect(ids()).toEqual(['netease:1', 'netease:2', 'netease:9', 'netease:3', 'netease:4']);
    // 当前曲与指针都不动，且没有触发换歌
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1);
    expect(usePlayerStore.getState().currentSong?.id).toBe(b.id);
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
  });

  it('已在队列的歌 → 移动到当前曲之后，队列长度不变（不复制）', async () => {
    seed();
    const d = usePlayerStore.getState().currentPlaylist[3];

    await usePlayerStore.getState().insertNext(d);

    expect(ids()).toEqual(['netease:1', 'netease:2', 'netease:4', 'netease:3']);
    expect(ids()).toHaveLength(4);
    expect(new Set(ids()).size).toBe(4);
  });

  it('已经在「当前曲之后」这一位 → 幂等（连点两次结果稳定）', async () => {
    const { c } = seed();

    await usePlayerStore.getState().insertNext(c);
    const afterFirst = ids();
    await usePlayerStore.getState().insertNext(c);

    expect(afterFirst).toEqual(['netease:1', 'netease:2', 'netease:3', 'netease:4']);
    expect(ids()).toEqual(afterFirst);
  });

  it('当前曲是最后一首 → 插到队尾，不越界', async () => {
    const a = song('netease:1', 'A');
    const b = song('netease:2', 'B');
    usePlayerStore.setState({ currentPlaylist: [a, b], currentPlaylistIndex: 1, currentSong: b });

    await usePlayerStore.getState().insertNext(song('netease:9', 'X'));

    expect(ids()).toEqual(['netease:1', 'netease:2', 'netease:9']);
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1);
  });

  it('移动已在队首的歌 → 移到当前曲之后，不产生重复 id（拖拽排序前提）', async () => {
    seed();
    const a = usePlayerStore.getState().currentPlaylist[0];

    await usePlayerStore.getState().insertNext(a);

    expect(ids()).toEqual(['netease:2', 'netease:1', 'netease:3', 'netease:4']);
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
    expect(usePlayerStore.getState().currentSong?.id).toBe('netease:2');
  });

  it('队列为空 → 等价于「开始播放这首」（队列 = [song]、index = 0、真的走播放链路）', async () => {
    const x = song('netease:9', 'X');

    await usePlayerStore.getState().insertNext(x);

    expect(ids()).toEqual(['netease:9']);
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
    expect(usePlayerStore.getState().currentSong?.id).toBe('netease:9');
    expect(audioPlayerMock.player.load).toHaveBeenCalled();
  });

  it('有队列但无当前曲（stop() 之后 index = -1）→ 直接播这首（播放链路会按队列重建，指针落在它身上）', async () => {
    const a = song('netease:1', 'A');
    const b = song('netease:2', 'B');
    const x = song('netease:9', 'X');
    usePlayerStore.setState({ currentPlaylist: [a, b], currentPlaylistIndex: -1, currentSong: null });

    await usePlayerStore.getState().insertNext(x);

    // 没有「当前曲之后」这个位置，故不插队——而是走「开始播放」，队列由播放链路建成 [a, b, x]
    expect(ids()).toEqual(['netease:1', 'netease:2', 'netease:9']);
    expect(usePlayerStore.getState().currentSong?.id).toBe('netease:9');
    expect(audioPlayerMock.player.load).toHaveBeenCalled();
  });

  it('落盘：插入 / 移动都写 localStorage 队列，重启后顺序一致', async () => {
    seed();
    await usePlayerStore.getState().insertNext(song('netease:9', 'X'));

    const raw = JSON.parse(localStorage.getItem('mplayer_queue') || '{}');
    expect(raw.playlist.map((s: Song) => s.id)).toEqual(['netease:1', 'netease:2', 'netease:9', 'netease:3', 'netease:4']);
    expect(raw.index).toBe(1);
  });

  it('先播一首再插队：与播放链路共存（当前曲仍是被播的那首）', async () => {
    const a = song('netease:1', 'A');
    const b = song('netease:2', 'B');
    await usePlayerStore.getState().play(a);
    usePlayerStore.setState({ currentPlaylist: [a, b], currentPlaylistIndex: 0 });

    await usePlayerStore.getState().insertNext(song('netease:9', 'X'));

    expect(ids()).toEqual(['netease:1', 'netease:9', 'netease:2']);
    expect(usePlayerStore.getState().currentSong?.id).toBe('netease:1');
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// insertAfter：插入位数学只此一份（与 moveItem 同处）
// ---------------------------------------------------------------------------
describe('insertAfter 边界', () => {
  it('afterIndex 越界一律夹到合法区间，不抛', async () => {
    const { insertAfter } = await import('../utils/reorder');
    expect(insertAfter([1, 2, 3], -1, 0)).toEqual([0, 1, 2, 3]);
    expect(insertAfter([1, 2, 3], 2, 9)).toEqual([1, 2, 3, 9]);
    expect(insertAfter([1, 2, 3], 99, 9)).toEqual([1, 2, 3, 9]);
    expect(insertAfter([], -1, 7)).toEqual([7]);
  });
});
