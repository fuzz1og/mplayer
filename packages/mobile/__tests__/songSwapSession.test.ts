import { describe, expect, it, vi } from 'vitest';
import type { Song, SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '../services/sourceSwap';
import { createSwapSession, type SongSwapDeps } from '../services/songSwapSession';

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

function makeDeps(overrides: Partial<SongSwapDeps> = {}) {
  const scheduled: (() => void)[] = [];
  const deps: SongSwapDeps = {
    search: vi.fn(async () => [] as SwapCandidate[]),
    probe: vi.fn(async (candidates: SwapCandidate[]) => candidates),
    apply: vi.fn((_song: Song, _source: SourceKey, c: SwapCandidate) => ({ ...c.song })),
    onApplied: vi.fn(),
    onEmptySource: vi.fn(),
    onApplyFailed: vi.fn(),
    confirmUnplayable: vi.fn((_candidate: SwapCandidate, proceed: () => void) => proceed()),
    scheduleClose: vi.fn((run: () => void) => { scheduled.push(run); }),
    ...overrides,
  };
  return { deps, close: () => scheduled.forEach((run) => run()) };
}

const ids = (candidates: SwapCandidate[]) => candidates.map((c) => c.song.id);

describe('createSwapSession 两阶段迁移', () => {
  it('open 重置上一次会话（回到阶段 1，弹层打开）', async () => {
    const { deps } = makeDeps({ search: vi.fn(async () => [candidate('q1')]) });
    const session = createSwapSession(deps);
    session.open(song('n1'));
    await session.selectSource('qq');
    expect(ids(session.getSnapshot().candidates)).toEqual(['q1']);

    session.open(song('n2', '七里香'));
    expect(session.getSnapshot()).toMatchObject({
      visible: true, loading: false, success: false, candidates: [], source: null,
    });
    expect(session.getSnapshot().song?.id).toBe('n2');
  });

  it('目标源无候选：提示并留在阶段 1', async () => {
    const { deps } = makeDeps();
    const session = createSwapSession(deps);
    session.open(song('n1'));

    await session.selectSource('qq');

    expect(deps.onEmptySource).toHaveBeenCalledWith('qq');
    expect(session.getSnapshot()).toMatchObject({ loading: false, source: null, candidates: [] });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it('无 source 时 selectCandidate 不生效', () => {
    const { deps } = makeDeps();
    const session = createSwapSession(deps);
    session.open(song('n1'));
    session.selectCandidate(candidate('q1'));
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('成功迁移：apply → onApplied → onSwapped → success → 延时关闭', async () => {
    const original = song('n1');
    const found = candidate('q1');
    const { deps, close } = makeDeps({ search: vi.fn(async () => [found]) });
    const session = createSwapSession(deps);
    const onSwapped = vi.fn();
    session.open(original, { onSwapped });
    await session.selectSource('qq');
    expect(session.getSnapshot().source).toBe('qq');

    session.selectCandidate(found);

    expect(deps.apply).toHaveBeenCalledWith(original, 'qq', found);
    expect(deps.onApplied).toHaveBeenCalledWith(original, expect.objectContaining({ id: 'q1' }), found);
    expect(onSwapped).toHaveBeenCalledWith(original, expect.objectContaining({ id: 'q1' }));
    expect(session.getSnapshot().success).toBe(true);

    close();
    expect(session.getSnapshot()).toMatchObject({ visible: false, candidates: [], source: null });
  });

  it('探测为不可播：用户确认后才切换', async () => {
    let proceed: (() => void) | null = null;
    const { deps } = makeDeps({
      search: vi.fn(async () => [candidate('q1', false)]),
      confirmUnplayable: vi.fn((_candidate: SwapCandidate, run: () => void) => { proceed = run; }),
    });
    const session = createSwapSession(deps);
    session.open(song('n1'));
    await session.selectSource('qq');

    session.selectCandidate(candidate('q1', false));
    expect(deps.confirmUnplayable).toHaveBeenCalledTimes(1);
    expect(deps.apply).not.toHaveBeenCalled();

    proceed!();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(deps.onApplied).toHaveBeenCalledTimes(1);
  });

  it('apply 失败：提示且不进入成功态', async () => {
    const { deps } = makeDeps({
      search: vi.fn(async () => [candidate('q1')]),
      apply: vi.fn(() => null),
    });
    const session = createSwapSession(deps);
    session.open(song('n1'));
    await session.selectSource('qq');

    session.selectCandidate(candidate('q1'));

    expect(deps.onApplyFailed).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({ success: false, loading: false });
    expect(deps.onApplied).not.toHaveBeenCalled();
    expect(deps.scheduleClose).not.toHaveBeenCalled();
  });

  it('back：回到阶段 1 并丢弃在途搜索结果', async () => {
    const pending = deferred<SwapCandidate[]>();
    const { deps } = makeDeps({ search: vi.fn(() => pending.promise) });
    const session = createSwapSession(deps);
    session.open(song('n1'));

    const search = session.selectSource('qq');
    expect(session.getSnapshot().loading).toBe(true);
    session.back();
    expect(session.getSnapshot()).toMatchObject({ loading: false, candidates: [], source: null, visible: true });

    pending.resolve([candidate('q1')]);
    await search;
    expect(session.getSnapshot().candidates).toEqual([]);
    expect(deps.onEmptySource).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it('close：只隐藏弹层（保留内容播退场）并丢弃在途结果', async () => {
    const pending = deferred<SwapCandidate[]>();
    const { deps } = makeDeps({ search: vi.fn(() => pending.promise) });
    const session = createSwapSession(deps);
    const original = song('n1');
    session.open(original);

    const search = session.selectSource('qq');
    session.close();
    expect(session.getSnapshot().visible).toBe(false);
    // BottomSheet 退场动画期间仍要渲染上一帧内容
    expect(session.getSnapshot().song).toBe(original);

    pending.resolve([candidate('q1')]);
    await search;
    expect(session.getSnapshot().candidates).toEqual([]);
  });
});

describe('createSwapSession 序号守卫', () => {
  it('并发 selectSource：只保留最后一次意图的候选（慢搜索不覆盖）', async () => {
    const qqSearch = deferred<SwapCandidate[]>();
    const kuwoSearch = deferred<SwapCandidate[]>();
    const { deps } = makeDeps({
      search: vi.fn((_song: Song, source: SourceKey) => (source === 'qq' ? qqSearch.promise : kuwoSearch.promise)),
    });
    const session = createSwapSession(deps);
    session.open(song('n1'));

    const first = session.selectSource('qq');
    const second = session.selectSource('kuwo');

    kuwoSearch.resolve([candidate('k1')]);
    await second;
    expect(session.getSnapshot().source).toBe('kuwo');
    expect(ids(session.getSnapshot().candidates)).toEqual(['k1']);

    qqSearch.resolve([candidate('q1')]);
    await first;
    // QQ 的慢结果被序号守卫丢弃，酷我的候选不被覆盖
    expect(session.getSnapshot().source).toBe('kuwo');
    expect(ids(session.getSnapshot().candidates)).toEqual(['k1']);
    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.onEmptySource).not.toHaveBeenCalled();
  });

  it('过期探测结果不覆盖当前源的候选', async () => {
    const qqCandidates = [candidate('q1')];
    const kuwoCandidates = [candidate('k1')];
    const qqProbe = deferred<SwapCandidate[]>();
    const { deps } = makeDeps({
      search: vi.fn(async (_song: Song, source: SourceKey) => (source === 'qq' ? qqCandidates : kuwoCandidates)),
      probe: vi.fn((candidates: SwapCandidate[]) =>
        candidates[0].song.id === 'q1' ? qqProbe.promise : Promise.resolve(candidates)),
    });
    const session = createSwapSession(deps);
    session.open(song('n1'));

    const first = session.selectSource('qq');
    await tick(); // QQ 搜索完成，探测挂起（候选先显示「检测中」）
    expect(ids(session.getSnapshot().candidates)).toEqual(['q1']);

    await session.selectSource('kuwo');
    expect(ids(session.getSnapshot().candidates)).toEqual(['k1']);

    qqProbe.resolve([{ ...candidate('q1'), playable: false }]);
    await first;
    // 迟到的 QQ 探测结果被丢弃
    expect(ids(session.getSnapshot().candidates)).toEqual(['k1']);
    expect(session.getSnapshot().source).toBe('kuwo');
  });

  it('成功后的延时关闭不会误关期间新开的会话', async () => {
    const { deps, close } = makeDeps({ search: vi.fn(async () => [candidate('q1')]) });
    const session = createSwapSession(deps);
    session.open(song('n1'));
    await session.selectSource('qq');
    session.selectCandidate(candidate('q1'));

    session.open(song('n2', '七里香')); // 1.2s 内为另一首歌开新弹层
    close(); // 旧会话的延时关闭这时才触发

    expect(session.getSnapshot().song?.id).toBe('n2');
    expect(session.getSnapshot().visible).toBe(true);
  });
});
