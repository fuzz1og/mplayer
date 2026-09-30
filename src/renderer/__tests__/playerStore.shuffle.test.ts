import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyShuffleOrder, clearPrefetchCache, type Song } from '@mplayer/core';

// --- Mock 准备：与 playerStore.insertNext.test.ts 同款（audioPlayer / callMusicApi / IpcClient / songCoverRefresh）---
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

const A = 'netease:1';
const B = 'netease:2';
const C = 'netease:3';
const D = 'netease:4';

const baseSongs = () => [song(A), song(B), song(C), song(D)];
const ids = () => usePlayerStore.getState().currentPlaylist.map((s) => s.id);
const shuffleOf = () => usePlayerStore.getState().shuffle;

/** 固定队列 [A,B,C,D] + 指定随机序/游标；当前曲 = order[cursor] */
function seed(order: string[] = [B, C, D, A], cursor = 0) {
  const songs = baseSongs();
  const currentId = order[cursor];
  const index = songs.findIndex((s) => s.id === currentId);
  usePlayerStore.setState({
    currentPlaylist: songs,
    currentPlaylistIndex: index,
    currentSong: index >= 0 ? songs[index] : null,
    playMode: '随机播放',
    shuffle: { order: [...order], cursor },
    isPlaying: true,
  });
  return songs;
}

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
    shuffle: null,
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
// #511 随机推进：消费「洗牌序 + 游标」，不再现抽
// ---------------------------------------------------------------------------
describe('playNext / playPrevious 消费随机序列（#511）', () => {
  it('playNext：游标前进一格，播放序列中的下一张', async () => {
    seed([B, C, D, A], 0); // 当前 B（成员下标 1）

    usePlayerStore.getState().playNext();

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(2); // C
    expect(shuffleOf()).toEqual({ order: [B, C, D, A], cursor: 1 });
    await vi.waitFor(() =>
      expect(audioPlayerMock.player.load).toHaveBeenCalledWith(expect.objectContaining({ id: C })),
    );
  });

  it('playPrevious：回到序列里的上一张，不再现抽（回归点）', async () => {
    seed([B, C, D, A], 0);

    usePlayerStore.getState().playPrevious();

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0); // A
    expect(shuffleOf()!.cursor).toBe(3);
    await vi.waitFor(() =>
      expect(audioPlayerMock.player.load).toHaveBeenCalledWith(expect.objectContaining({ id: A })),
    );
  });

  it('prev 之后 next 回到原曲（可逆）', () => {
    seed([B, C, D, A], 0);

    usePlayerStore.getState().playPrevious(); // → A，游标 3
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
    usePlayerStore.getState().playNext(); // 游标 3 → 0 → B

    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1);
    expect(shuffleOf()!.cursor).toBe(0);
  });

  it('两端回绕', () => {
    seed([B, C, D, A], 3); // 当前 A
    usePlayerStore.getState().playNext();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(1); // B

    seed([B, C, D, A], 0); // 当前 B
    usePlayerStore.getState().playPrevious();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0); // A
  });

  it('单元素队列：next / prev 都归位不切歌', () => {
    const only = [song(A)];
    usePlayerStore.setState({
      currentPlaylist: only, currentPlaylistIndex: 0, currentSong: only[0],
      playMode: '随机播放', shuffle: { order: [A], cursor: 0 },
    });

    usePlayerStore.getState().playNext();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
    usePlayerStore.getState().playPrevious();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(0);
  });

  it('无序列时按当前队列现洗一份（游标落在新曲上，仍不重复当前）', () => {
    const songs = baseSongs();
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 0, currentSong: songs[0],
      playMode: '随机播放', shuffle: null,
    });

    usePlayerStore.getState().playNext();

    const s = usePlayerStore.getState();
    expect(s.shuffle).not.toBeNull();
    expect(s.shuffle!.order).toHaveLength(4);
    expect(s.currentPlaylistIndex).not.toBe(0);
    expect(s.shuffle!.order[s.shuffle!.cursor]).toBe(s.currentPlaylist[s.currentPlaylistIndex].id);
  });
});

// ---------------------------------------------------------------------------
// #511「下一首播放」：随机模式下插到序列中当前曲的下一格
// ---------------------------------------------------------------------------
describe('insertNext（随机模式，序列内插入位）', () => {
  it('不在队列的新歌 → 追加成员并插到序列当前曲下一格，不打断当前播放', async () => {
    seed([A, B, C, D], 1); // 当前 B
    const x = song('netease:9');

    await usePlayerStore.getState().insertNext(x);

    const s = usePlayerStore.getState();
    expect(s.currentPlaylist.map((p) => p.id)).toEqual([A, B, C, D, 'netease:9']);
    expect(s.shuffle!.order).toEqual([A, B, 'netease:9', C, D]);
    expect(s.shuffle!.cursor).toBe(1);
    expect(s.currentPlaylistIndex).toBe(1);
    expect(s.currentSong?.id).toBe(B);
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
  });

  it('队列页显示序 = 随机序（applyShuffleOrder）', async () => {
    seed([A, B, C, D], 1);
    await usePlayerStore.getState().insertNext(song('netease:9'));

    const s = usePlayerStore.getState();
    expect(applyShuffleOrder(s.currentPlaylist, s.shuffle).map((p) => p.id))
      .toEqual([A, B, 'netease:9', C, D]);
  });

  it('已在队列 → 移动到当前曲下一格，队列长度不变（不复制）', async () => {
    seed([A, B, C, D], 1);

    await usePlayerStore.getState().insertNext(song(D));

    expect(ids()).toEqual([A, B, C, D]);
    expect(shuffleOf()!.order).toEqual([A, B, D, C]);
  });

  it('幂等：连点两次结果稳定', async () => {
    seed([A, B, C, D], 1);

    await usePlayerStore.getState().insertNext(song(C));
    const first = shuffleOf()!.order;
    await usePlayerStore.getState().insertNext(song(C));

    expect(first).toEqual([A, B, C, D]); // 已在目标格 → 原样
    expect(shuffleOf()!.order).toEqual(first);
  });

  it('点的是当前曲 → no-op', async () => {
    seed([A, B, C, D], 1);

    await usePlayerStore.getState().insertNext(song(B));

    expect(shuffleOf()!.order).toEqual([A, B, C, D]);
    expect(audioPlayerMock.player.load).not.toHaveBeenCalled();
  });

  it('队列为空 → 等价于「开始播放这首」，并建立序列', async () => {
    usePlayerStore.setState({
      currentPlaylist: [], currentPlaylistIndex: -1, currentSong: null,
      playMode: '随机播放', shuffle: null,
    });

    await usePlayerStore.getState().insertNext(song('netease:9'));

    const s = usePlayerStore.getState();
    expect(s.currentPlaylist.map((p) => p.id)).toEqual(['netease:9']);
    expect(s.currentPlaylistIndex).toBe(0);
    expect(s.shuffle?.order).toEqual(['netease:9']);
    await vi.waitFor(() => expect(audioPlayerMock.player.load).toHaveBeenCalled());
  });

  it('落盘：插入后 localStorage 队列带序列与游标（重启顺序不变）', async () => {
    seed([A, B, C, D], 1);

    await usePlayerStore.getState().insertNext(song('netease:9'));

    const raw = JSON.parse(localStorage.getItem('mplayer_queue') || '{}');
    expect(raw.index).toBe(1);
    expect(raw.shuffle.order).toEqual([A, B, 'netease:9', C, D]);
    expect(raw.shuffle.cursor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 序列的建立 / 保留 / 编辑
// ---------------------------------------------------------------------------
describe('setPlayMode / setCurrentPlaylist 与序列', () => {
  it('进随机：现洗一份且游标落在当前曲', () => {
    const songs = baseSongs();
    usePlayerStore.setState({
      currentPlaylist: songs, currentPlaylistIndex: 1, currentSong: songs[1],
      playMode: '列表循环', shuffle: null,
    });

    usePlayerStore.getState().setPlayMode('随机播放');

    const s = usePlayerStore.getState();
    expect(s.shuffle).not.toBeNull();
    expect([...s.shuffle!.order].sort()).toEqual([A, B, C, D]);
    expect(s.shuffle!.order[s.shuffle!.cursor]).toBe(B);
  });

  it('切回列表循环：序列保留但不参与推进', () => {
    seed([B, C, D, A], 0);

    usePlayerStore.getState().setPlayMode('列表循环');
    expect(shuffleOf()).toEqual({ order: [B, C, D, A], cursor: 0 });

    usePlayerStore.getState().playNext();
    expect(usePlayerStore.getState().currentPlaylistIndex).toBe(2); // 成员序 B→C，与序列无关
  });

  it('再次进随机：沿用同一序列（会话内稳定）', () => {
    seed([B, C, D, A], 0);

    usePlayerStore.getState().setPlayMode('列表循环');
    usePlayerStore.getState().playNext(); // C（成员下标 2）
    usePlayerStore.getState().setPlayMode('随机播放');

    const s = usePlayerStore.getState();
    expect(s.shuffle!.order).toEqual([B, C, D, A]);
    expect(s.shuffle!.cursor).toBe(1); // 游标回到 C 在序列中的位置
  });

  it('setCurrentPlaylist 同一批歌（封面回填）保留既有顺序', () => {
    seed([B, C, D, A], 0);
    const withCover = usePlayerStore.getState().currentPlaylist.map((s) => ({ ...s, cover: `https://c/${s.id}` }));

    usePlayerStore.getState().setCurrentPlaylist(withCover, 1);

    expect(shuffleOf()).toEqual({ order: [B, C, D, A], cursor: 0 });
  });

  it('setCurrentPlaylist 换歌单 → 旧序列作废并重洗，游标落在起点曲', () => {
    seed([B, C, D, A], 0);
    const fresh = [song('netease:7'), song('netease:8')];

    usePlayerStore.getState().setCurrentPlaylist(fresh, 1);

    const s = usePlayerStore.getState();
    expect([...s.shuffle!.order].sort()).toEqual(['netease:7', 'netease:8']);
    expect(s.shuffle!.order[s.shuffle!.cursor]).toBe('netease:8');
  });
});

describe('随机序的编辑（拖拽 / 删除 / 换源）', () => {
  it('reorderShuffle：改的是随机序本身，成员顺序不动，游标跟随当前曲', () => {
    seed([A, B, C, D], 1); // 当前 B

    usePlayerStore.getState().reorderShuffle(0, 2);

    const s = usePlayerStore.getState();
    expect(s.shuffle!.order).toEqual([B, C, A, D]);
    expect(s.shuffle!.cursor).toBe(0);
    expect(s.currentPlaylist.map((p) => p.id)).toEqual([A, B, C, D]);
  });

  it('reorderShuffle：越界 / 原地是空操作', () => {
    seed([A, B, C, D], 1);

    usePlayerStore.getState().reorderShuffle(-1, 2);
    usePlayerStore.getState().reorderShuffle(0, 9);
    usePlayerStore.getState().reorderShuffle(1, 1);

    expect(shuffleOf()!.order).toEqual([A, B, C, D]);
  });

  it('removeFromQueue：序列同步删 id、游标跟随', () => {
    seed([A, B, C, D], 1); // 当前 B

    usePlayerStore.getState().removeFromQueue(2); // 删 C

    const s = usePlayerStore.getState();
    expect(s.currentPlaylist.map((p) => p.id)).toEqual([A, B, D]);
    expect(s.shuffle!.order).toEqual([A, B, D]);
    expect(s.shuffle!.cursor).toBe(1);
  });

  it('replaceQueueSong：序列里同格换 id，顺序与游标位置不变', async () => {
    seed([A, B, C, D], 1);

    await usePlayerStore.getState().replaceQueueSong(C, song('netease:99'));

    const s = usePlayerStore.getState();
    expect(s.shuffle!.order).toEqual([A, B, 'netease:99', D]);
    expect(s.shuffle!.cursor).toBe(1);
  });
});
