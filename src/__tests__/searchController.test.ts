import { describe, it, expect, vi } from 'vitest';
import { createSearchController } from '@mplayer/core';

describe('createSearchController', () => {
  it('exposes search, loadMore, reset', () => {
    const ctrl = createSearchController({
      searchFn: vi.fn().mockResolvedValue([]),
      getState: vi.fn().mockReturnValue({}),
      setState: vi.fn(),
    });
    expect(typeof ctrl.search).toBe('function');
    expect(typeof ctrl.loadMore).toBe('function');
    expect(typeof ctrl.reset).toBe('function');
  });

  it('search sets loading, calls searchFn, updates state', async () => {
    const searchFn = vi.fn().mockResolvedValue([{ key: 'a', songs: [1] }]);
    const setState = vi.fn();
    const getState = vi.fn().mockReturnValue({ source: 'netease' });

    const ctrl = createSearchController({ searchFn, getState, setState });
    await ctrl.search('hello');

    expect(searchFn).toHaveBeenCalledWith('hello', 1, 'netease');
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ loading: true }));
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
  });

  it('ignores stale search results (race guard)', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const searchFn = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
      .mockResolvedValue([{ key: 'b', songs: [2] }]);

    const setState = vi.fn();
    const getState = vi.fn().mockReturnValue({ source: 'netease' });

    const ctrl = createSearchController({ searchFn, getState, setState });

    // Start first search (will hang)
    const p1 = ctrl.search('first');
    // Start second search (resolves immediately)
    await ctrl.search('second');

    // Resolve first search with stale results
    resolveFirst([{ key: 'a', songs: [1] }]);
    await p1;

    // setState should NOT have been called with stale 'first' results
    const lastCall = setState.mock.calls[setState.mock.calls.length - 1][0];
    expect(lastCall.results?.[0]?.key).toBe('b');
  });

  it('loadMore failure clears loadingMore even when stale (new search in flight)', async () => {
    // 场景：loadMore 挂起时新搜索提交（seq 变化），随后 loadMore 失败。
    // 若失败路径不清 loadingMore，新结果区的加载 footer / 无限滚动 guard 会永久卡死。
    let rejectLoadMore!: (e: Error) => void;
    const searchFn = vi.fn()
      .mockResolvedValueOnce([{ key: 'a', songs: [1] }]) // first search
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectLoadMore = reject; })) // loadMore (hangs)
      .mockResolvedValueOnce([{ key: 'b', songs: [2] }]); // new search
    const setState = vi.fn();
    const state: Record<string, any> = { query: 'q', page: 1, hasMore: true, loading: false, loadingMore: false, results: [{ key: 'a', songs: [1] }], source: 'netease' };
    const getState = vi.fn(() => ({ ...state }));

    const ctrl = createSearchController({ searchFn, getState, setState });

    await ctrl.search('q');
    // 手动同步 getState 返回的 state（测试里 setState 不联动 getState）
    Object.assign(state, { query: 'q', page: 1, hasMore: true, loading: false, loadingMore: false, results: [{ key: 'a', songs: [1] }] });

    const loadMorePromise = ctrl.loadMore();
    // loadMore 进行中，新搜索提交（seq 前进，loadMore 变 stale）
    Object.assign(state, { query: 'new', page: 1, hasMore: true, loading: true, loadingMore: false, results: [] });
    const searchPromise = ctrl.search('new');
    // 旧 loadMore 姗姗来迟地失败
    rejectLoadMore(new Error('load more failed'));
    await Promise.allSettled([loadMorePromise, searchPromise]);

    // 失败路径的 setState 必须清除 loadingMore（该调用只有 loadingMore: false 一个键），
    // 不能留下卡死标志
    const staleCleanupCall = setState.mock.calls.find(
      c => c[0] && Object.keys(c[0]).length === 1 && c[0].loadingMore === false
    );
    expect(staleCleanupCall).toBeTruthy();
  });
});
