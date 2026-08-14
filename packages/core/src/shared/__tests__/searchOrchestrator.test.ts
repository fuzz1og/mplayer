import { describe, it, expect, vi } from 'vitest';
import type { Song, SongGroup, SourceKey } from '../../types/index.js';
import { createSearchOrchestrator } from '../searchOrchestrator.js';

function song(id: string, name: string, artist: string, source: string): Song {
  return { id, name, artist, album: '', duration: 100, sourceType: source as SourceKey, url: '', cover: '', lrc: '' };
}

/**
 * 与 core `musicApi.groupIntoSongGroups` 同语义的独立分组实现，用于断言
 * 「最终分组 == 一次性全量」不变量。期望值来自独立来源，避免自证。
 */
function groupSongs(songs: Song[]): SongGroup[] {
  const map = new Map<string, SongGroup>();
  for (const s of songs) {
    const key = `${s.name.trim().toLowerCase()}|${s.artist.trim().toLowerCase()}`;
    const ex = map.get(key);
    if (ex) ex.songs.push(s);
    else map.set(key, { key, name: s.name, artist: s.artist, songs: [s] });
  }
  return Array.from(map.values());
}

describe('createSearchOrchestrator', () => {
  const SOURCES = ['a', 'b', 'c'] as const;

  it('exposes search, loadMore, reset, getState, subscribe', () => {
    const o = createSearchOrchestrator({ searchOneSource: vi.fn(async () => []), sources: SOURCES });
    expect(typeof o.search).toBe('function');
    expect(typeof o.loadMore).toBe('function');
    expect(typeof o.reset).toBe('function');
    expect(typeof o.getState).toBe('function');
    expect(typeof o.subscribe).toBe('function');
  });

  it('subscribe returns an unsubscribe function that stops future emissions', async () => {
    const o = createSearchOrchestrator({ searchOneSource: vi.fn(async () => []), sources: SOURCES });
    const listener = vi.fn();
    const unsubscribe = o.subscribe(listener);
    await o.search('x', 'a');
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    await o.search('y', 'a');
    expect(listener).not.toHaveBeenCalled();
  });

  describe('单源路由', () => {
    it('单源 produce 单次 call 吐一批：results 为 [{key: source, name: source, songs}]', async () => {
      const searchOneSource = vi.fn(async (_q: string, _p: number, src: string): Promise<Song[]> =>
        src === 'a' ? [song('a1', '独奏者', '作曲家', 'a')] : []
      );
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      await o.search('晴天', 'a');

      expect(searchOneSource).toHaveBeenCalledTimes(1);
      expect(searchOneSource).toHaveBeenCalledWith('晴天', 1, 'a');
      const s = o.getState();
      expect(s.loading).toBe(false);
      expect(s.results).toHaveLength(1);
      expect(s.results[0].key).toBe('a');
      expect(s.results[0].songs).toHaveLength(1);
    });

    it('单源空结果 → hasMore=false', async () => {
      const o = createSearchOrchestrator({ searchOneSource: vi.fn(async () => []), sources: SOURCES });
      await o.search('没有', 'a');
      expect(o.getState().hasMore).toBe(false);
    });

    it('单源 loadMore 走第 2 页并同源去重', async () => {
      const searchOneSource = vi.fn(async (_q: string, page: number): Promise<Song[]> => {
        if (page === 1) return [song('s1', '晴天', '周杰伦', 'a')];
        return [
          { ...song('s2', '晴天', '周杰伦', 'a') }, // 与第一页同源同名同内容 → 去重
          song('s3', '轨迹', '周杰伦', 'a'),
        ];
      });
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });
      await o.search('晴天', 'a');
      expect(o.getState().results[0].songs).toHaveLength(1);

      await o.loadMore();

      expect(searchOneSource).toHaveBeenLastCalledWith('晴天', 2, 'a');
      const result = o.getState().results;
      expect(result[0].songs.map((s) => s.id)).toEqual(['s1', 's3']);
      expect(o.getState().page).toBe(2);
    });
  });

  describe('渐进不变量（最终分组 == 一次性全量）', () => {
    it('打乱源完成顺序，最终分组与固定源序一次性全量一致', async () => {
      // 各源返回同名歌的不同版本；控制完成顺序：a 最慢最后到，b 先到，c 次之
      const songsBySource: Record<string, Song[]> = {
        a: [song('a1', '晴天', '周杰伦', 'a'), song('a2', '轨迹', '周杰伦', 'a')],
        b: [song('b1', '晴天', '周杰伦', 'b')],
        c: [song('c1', '轨迹', '周杰伦', 'c')],
      };
      const deferred: Record<string, () => void> = {};
      const searchOneSource = vi.fn((_q: string, _p: number, src: string): Promise<Song[]> =>
        new Promise((resolve) => {
          deferred[src] = () => resolve(songsBySource[src]);
        })
      );
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      const p = o.search('晴天', 'all');
      // 完成顺序 b → c → a（反转固定源序），确保迟到的 a 不破坏最终分组
      deferred.b();
      await Promise.resolve();
      expect(o.getState().results).toEqual(groupSongs([...songsBySource.b]));

      deferred.c();
      await Promise.resolve();
      expect(o.getState().results).toEqual(groupSongs([...songsBySource.b, ...songsBySource.c]));

      deferred.a();
      await p;

      // 一次性全量 = 固定源序 [a,b,c] 全部歌曲
      const oneShot = groupSongs([...songsBySource.a, ...songsBySource.b, ...songsBySource.c]);
      expect(o.getState().results).toEqual(oneShot);
      // 组内顺序 = 固定源序（a 先于 b/c），不受完成顺序影响
      const 晴天 = o.getState().results.find((g) => g.name === '晴天');
      expect(晴天?.songs.map((s) => s.sourceType)).toEqual(['a', 'b']);
    });
  });

  describe('组内合并', () => {
    it('跨源同名保留不同版本；同源到达重复不堆积', async () => {
      // netease/q... 这里用 a/b 两源同名；a 源同一页里已有重复 id（同源去重）
      const searchOneSource = vi.fn(async (_q: string, _p: number, src: string): Promise<Song[]> => {
        if (src === 'a') return [song('a1', '晴天', '周杰伦', 'a'), song('a1', '晴天', '周杰伦', 'a')];
        return [song('b1', '晴天', '周杰伦', 'b')];
      });
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      await o.search('晴天', 'all');

      const 结果 = o.getState().results;
      expect(结果).toHaveLength(1); // 同名合并成一组
      const ids = 结果[0].songs.map((s: Song) => s.id + '@' + s.sourceType);
      // 跨源 a/b 都保留；a 源的重复 id 只保留一次
      expect(ids).toContain('a1@a');
      expect(ids).toContain('b1@b');
      expect(ids.filter((x: string) => x === 'a1@a')).toHaveLength(1);
    });
  });

  describe('loadMore 与渐进并发', () => {
    it('分页进行中触发展的源（新搜索）后，旧分页迟到结果不污染新结果、组不重复', async () => {
      // 用可控的 deferred 队列控制源 a 的每次调用（search page1 / loadMore page2 /
      // 新搜索 page1）完成时机；b、c 立即完成。
      const aQueue: (() => void)[] = [];
      const searchOneSource = vi.fn((_q: string, page: number, src: string): Promise<Song[]> => {
        if (src === 'b' && page === 1) return Promise.resolve([song('b1', '晴天', '周杰伦', 'b')]);
        if (src === 'b' && page === 2) return Promise.resolve([song('b2', '轨迹', '周杰伦', 'b')]);
        if (src === 'a') {
          return new Promise((resolve) => {
            aQueue.push(() => {
              if (page === 1) resolve([song('a1', '晴天', '周杰伦', 'a')]);
              else resolve([song('a3', '旧分页', '周杰伦', 'a')]); // page 2
            });
          });
        }
        return Promise.resolve([]); // c 以及页 2 的 c 都空
      });
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      // 第一次搜索 'all'：a page1 挂起，b/c 立即。resolve a page1 → 完成
      const p1 = o.search('晴天', 'all');
      aQueue.shift()!(); // resolve a page1
      await p1;
      expect(o.getState().results).toHaveLength(1);
      expect(o.getState().results[0].songs.map((x) => x.id)).toEqual(['a1', 'b1']); // 同名合并

      // loadMore：b page2 立即（轨迹）、c 空、a page2 挂起。随后新搜索取代
      const lm = o.loadMore();
      const p2 = o.search('新词', 'c'); // 并发分页里切换关键词+路由
      await p2;

      // 迟到的旧 loadMore 分页（a page2『旧分页』『晴天 a』）不得污染新查询
      aQueue.shift()!();
      await Promise.allSettled([lm]);

      const s = o.getState();
      expect(s.query).toBe('新词');
      for (const g of s.results) {
        expect(g.songs.filter((x) => x.name === '旧分页')).toHaveLength(0);
        expect(g.songs.filter((x) => x.id === 'a3')).toHaveLength(0);
      }
    });
  });

  describe('竞态交错：迟到源 × reset', () => {
    it('新搜索后迟到源结果被丢弃（stale）', async () => {
      let resolveA!: (songs: Song[]) => void;
      const searchOneSource = vi.fn((_q: string, _p: number, src: string): Promise<Song[]> =>
        src === 'a'
          ? new Promise((r) => { resolveA = r; })
          : Promise.resolve([song('b1', '晴天', '周杰伦', 'b')])
      );
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      // 第一次 'all' 搜索：a 挂起，b/c 立即（seq=1）
      const p1 = o.search('first', 'all');
      // 发起新单源搜索（立即完成，seq→2，第一次搜索变 stale）
      await o.search('second', 'c');
      // 迟到的 a 结果属于第一次搜索（seq=1），必须被丢弃
      resolveA([song('a1', '晴天', '周杰伦', 'a')]);
      await p1;

      const s = o.getState();
      expect(s.query).toBe('second');
      // 最终结果 = 单源 c，不含 a 的迟到版本
      expect(s.results.map((g) => g.key)).toEqual(['c']);
      expect(s.results[0].songs.map((x) => x.sourceType as string)).not.toContain('a');
    });

    it('reset 使进行中的 search 结果失效并清空状态', async () => {
      let resolveA!: (songs: Song[]) => void;
      const searchOneSource = vi.fn((_q: string, _p: number, src: string): Promise<Song[]> =>
        src === 'a' ? new Promise((r) => { resolveA = r; }) : Promise.resolve([song('b1', '晴天', '周杰伦', 'b')])
      );
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      const p = o.search('x', 'all');
      o.reset();
      expect(o.getState().results).toEqual([]);
      resolveA([song('a1', '迟到', '周杰伦', 'a')]);
      await p;
      expect(o.getState().results).toEqual([]); // 迟到结果不出现
    });
  });

  describe('错误处理', () => {
    it('search 单源失败设置 error 并清除 loading', async () => {
      const searchOneSource = vi.fn(async () => { throw new Error('boom'); });
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });
      await o.search('x', 'a');
      const s = o.getState();
      expect(s.loading).toBe(false);
      expect(s.error).toBeTruthy();
      expect(s.results).toEqual([]);
    });

    it('loadMore 失败清除 loadingMore（即便已被新搜索取代，也不留卡死标志）', async () => {
      let rejectLoadMore!: (e: Error) => void;
      const searchOneSource = vi.fn((_q: string, page: number, src: string): Promise<Song[]> => {
        if (src === 'c' && page === 1) return Promise.resolve([song('c1', '晴天', '周杰伦', 'c')]);
        if (src === 'c' && page === 2) return new Promise((_, reject) => { rejectLoadMore = reject; });
        return Promise.resolve([]); // a/b
      });
      const o = createSearchOrchestrator({ searchOneSource, sources: SOURCES });

      await o.search('q', 'c');
      expect(o.getState().results).toHaveLength(1);

      const lm = o.loadMore();
      // loadMore 挂起时发起新搜索（seq 前进 → loadMore 变 stale）
      const sp = o.search('new', 'c');
      // 旧 loadMore 姗姗来迟地失败
      rejectLoadMore(new Error('load more failed'));
      await Promise.allSettled([lm, sp]);

      // 失败的 loadMore 必须把 loadingMore 清掉，不留卡死标志
      expect(o.getState().loadingMore).toBe(false);
    });
  });
});
