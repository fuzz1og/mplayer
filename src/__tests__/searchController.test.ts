import { describe, it, expect, vi } from 'vitest';
import { createSearchController } from '../shared';

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
});