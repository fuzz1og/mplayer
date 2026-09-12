import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '../services/sourceSwap';
import {
  configureSongActions,
  useSongActionsStore,
  type SongActionEffects,
} from '../stores/songActionsStore';

function song(id: string, name = '晴天', sourceType: SourceKey = 'netease'): Song {
  return { id, name, artist: '周杰伦', album: '', duration: 240, sourceType, url: '', cover: '', lrc: '' };
}

function candidate(id: string, playable: boolean | null = true): SwapCandidate {
  return { song: { ...song(id, '晴天', 'qq') }, exact: true, score: 1, playable, tag: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

function makeEffects(overrides: Partial<SongActionEffects> = {}) {
  const scheduled: (() => void)[] = [];
  const effects: SongActionEffects = {
    search: vi.fn(async () => [] as SwapCandidate[]),
    probe: vi.fn(async (candidates: SwapCandidate[]) => candidates),
    apply: vi.fn((_song: Song, _source: SourceKey, c: SwapCandidate) => ({ ...c.song })),
    onApplied: vi.fn(),
    onEmptySource: vi.fn(),
    onApplyFailed: vi.fn(),
    confirmUnplayable: vi.fn((_candidate: SwapCandidate, run: () => void) => run()),
    scheduleClose: vi.fn((run: () => void) => { scheduled.push(run); }),
    download: vi.fn(),
    searchArtist: vi.fn(),
    ...overrides,
  };
  return { effects, close: () => scheduled.forEach((run) => run()) };
}

const state = () => useSongActionsStore.getState();
const ids = (candidates: SwapCandidate[]) => candidates.map((c) => c.song.id);

beforeEach(() => {
  configureSongActions(makeEffects().effects);
});

describe('songActionsStore 弹层归属', () => {
  it('任一时刻只有一个弹层可见：打开加入歌单/换源都收起操作面板', () => {
    state().openActions(song('n1'), { onRemove: vi.fn() });
    expect(state().actionSheet?.song.id).toBe('n1');
    expect(state().actionSheet?.visible).toBe(true);
    expect(state().playlist).toBeNull();

    state().openAddToPlaylist(song('n2'));
    expect(state().actionSheet?.visible).toBe(false);
    expect(state().playlist?.song.id).toBe('n2');
    expect(state().playlist?.visible).toBe(true);

    state().openActions(song('n3'));
    expect(state().playlist?.visible).toBe(false);
    expect(state().actionSheet?.song.id).toBe('n3');

    state().openSwap(song('n4'));
    expect(state().actionSheet?.visible).toBe(false);
    expect(state().playlist?.visible).toBe(false);
    expect(state().swap).toMatchObject({ visible: true, source: null, candidates: [] });
    expect(state().swap.song?.id).toBe('n4');
  });

  it('关闭动作只隐藏弹层（内容留给 BottomSheet 退场动画）', () => {
    state().openActions(song('n1'));
    state().closeActions();
    expect(state().actionSheet?.visible).toBe(false);
    expect(state().actionSheet?.song.id).toBe('n1');

    state().openAddToPlaylist(song('n1'));
    state().closeAddToPlaylist();
    expect(state().playlist?.visible).toBe(false);
    expect(state().playlist?.song.id).toBe('n1');

    state().openSwap(song('n1'));
    state().closeSwap();
    expect(state().swap.visible).toBe(false);
    expect(state().swap.song?.id).toBe('n1');
  });
});

describe('songActionsStore 换源编排', () => {
  it('并发选源：只保留最后一次意图的候选（守卫在控制器层同样成立）', async () => {
    const qqSearch = deferred<SwapCandidate[]>();
    const kuwoSearch = deferred<SwapCandidate[]>();
    const { effects } = makeEffects({
      search: vi.fn((_song: Song, source: SourceKey) => (source === 'qq' ? qqSearch.promise : kuwoSearch.promise)),
    });
    configureSongActions(effects);
    state().openSwap(song('n1'));

    const first = state().selectSwapSource('qq');
    const second = state().selectSwapSource('kuwo');

    kuwoSearch.resolve([candidate('k1')]);
    await second;
    expect(state().swap.source).toBe('kuwo');

    qqSearch.resolve([candidate('q1')]);
    await first;
    expect(state().swap.source).toBe('kuwo');
    expect(ids(state().swap.candidates)).toEqual(['k1']);
  });

  it('关闭换源弹层后在途探测结果被丢弃', async () => {
    const probe = deferred<SwapCandidate[]>();
    const { effects } = makeEffects({
      search: vi.fn(async () => [candidate('q1')]),
      probe: vi.fn(() => probe.promise),
    });
    configureSongActions(effects);
    state().openSwap(song('n1'));

    const pending = state().selectSwapSource('qq');
    await tick();
    state().closeSwap();
    probe.resolve([candidate('q1-probed')]);
    await pending;

    // 弹层已关：在途探测被守卫丢弃，候选维持关闭那一刻的内容（退场动画用）
    expect(state().swap.visible).toBe(false);
    expect(ids(state().swap.candidates)).toEqual(['q1']);
  });

  it('换源成功：通知持有列表的父组件并延时收起弹层', async () => {
    const found = candidate('q1');
    const { effects, close } = makeEffects({ search: vi.fn(async () => [found]) });
    configureSongActions(effects);
    const original = song('n1');
    const onSwap = vi.fn();

    // 行内「更多」→ 操作面板 →「换源完整版」
    state().openActions(original, { onSwap, onRemove: vi.fn() });
    state().openSwap(original, { onSwap });
    expect(state().actionSheet?.visible).toBe(false);

    await state().selectSwapSource('qq');
    expect(ids(state().swap.candidates)).toEqual(['q1']);
    state().selectSwapCandidate(found);

    expect(effects.apply).toHaveBeenCalledWith(original, 'qq', found);
    expect(effects.onApplied).toHaveBeenCalledTimes(1);
    expect(onSwap).toHaveBeenCalledWith(original, expect.objectContaining({ id: 'q1' }));
    expect(state().swap.success).toBe(true);

    close();
    expect(state().swap.visible).toBe(false);
  });

  it('swapBack 回到选源（弹层保持打开）', async () => {
    const { effects } = makeEffects({ search: vi.fn(async () => [candidate('q1')]) });
    configureSongActions(effects);
    state().openSwap(song('n1'));
    await state().selectSwapSource('qq');

    state().swapBack();

    expect(state().swap).toMatchObject({ visible: true, source: null, candidates: [], success: false });
  });

  it('目标源无候选：走提示回调且停留选源', async () => {
    const { effects } = makeEffects({ search: vi.fn(async () => [] as SwapCandidate[]) });
    configureSongActions(effects);
    state().openSwap(song('n1'));

    await state().selectSwapSource('qq');

    expect(effects.onEmptySource).toHaveBeenCalledWith('qq');
    expect(state().swap).toMatchObject({ loading: false, source: null, candidates: [] });
  });
});
