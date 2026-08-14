import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStore } = vi.hoisted(() => {
  const store = {
    sourceType: 'netease' as const,
    currentKeyword: '',
    page: 1,
    hasMore: true,
    loading: false,
    loadingMore: false,
    error: null as string | null,
    songs: [] as any[],
    groups: [] as any[],
    setState: vi.fn(),
    setAudioTag: vi.fn(),
  };
  return { mockStore: store };
});

vi.mock('../services/IpcClient', () => ({
  IpcClient: { invoke: vi.fn() },
}));

vi.mock('../store/searchStore', () => {
  return {
    useSearchStore: {
      getState: () => mockStore,
      setState: (partial: any) => {
        const { setState: _s, ...rest } = partial;
        void _s;
        Object.assign(mockStore, rest);
        mockStore.setState(partial);
      },
    },
  };
});

import { searchService } from '../services/searchService';

describe('searchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockStore.sourceType = 'netease';
    mockStore.currentKeyword = '';
    mockStore.page = 1;
    mockStore.hasMore = true;
    mockStore.loading = false;
    mockStore.loadingMore = false;
    mockStore.songs = [];
    mockStore.groups = [];
    mockStore.error = null;
  });

  afterEach(() => { vi.useRealTimers(); });

  describe('search', () => {
    it('应设置 loading 并调用 IPC（route 由 sourceType 派生）', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockSongs = [{ id: '1', name: '稻香', artist: '周杰伦' }];
      (IpcClient.invoke as any).mockResolvedValue(mockSongs);

      await searchService.search('周杰伦');

      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ loading: true }));
      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongs', '周杰伦', 1, 'netease');
      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ songs: mockSongs }));
    });

    it('IPC 失败应设置错误信息', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockRejectedValue(new Error('网络错误'));

      await searchService.search('周杰伦');

      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ error: '搜索失败，请重试' }));
    });

    it('sourceType=all 时渐进逐源调用并写 groups（不回退 searchAllSources）', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      // 逐源返回同名歌不同版本
      const bySource: Record<string, any[]> = {
        netease: [{ id: 'n1', name: '晴天', artist: '周杰伦' }],
        qq: [{ id: 'q1', name: '晴天', artist: '周杰伦' }],
      };
      (IpcClient.invoke as any).mockImplementation(async (_c: string, method?: string, _kw?: string, _p?: number, src?: string) => {
        if (method === 'searchSongs') return bySource[src as string] || [];
        if (method === 'probeSongsBatch') return [];
        return undefined;
      });

      mockStore.sourceType = 'all';
      await searchService.search('晴天');

      expect(mockStore.setState).toHaveBeenCalledWith(
        expect.objectContaining({ groups: expect.arrayContaining([expect.objectContaining({ songs: expect.any(Array) })]) })
      );
      // groups 里同名歌曲含 netease + qq 两版本
      const groups = mockStore.groups as any[];
      expect(groups.length).toBeGreaterThan(0);
      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongs', '晴天', 1, 'netease');
      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:call', 'searchSongs', '晴天', 1, 'qq');
    });

    it('probes new results through the main-process batch IPC', async () => {
      vi.useRealTimers();
      const { IpcClient } = await import('../services/IpcClient');
      const songs = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`,
        name: `song-${i}`,
        artist: 'artist',
        url: '',
      }));
      (IpcClient.invoke as any).mockImplementation(async (channel: string, method?: string) => {
        if (channel === 'musicApi:call' && method === 'searchSongs') return songs;
        if (channel === 'musicApi:call' && method === 'probeSongsBatch') {
          return songs.map((song) => ({ songId: song.id, tag: 'valid' as const }));
        }
        return undefined;
      });

      await searchService.search('周杰伦');

      await vi.waitFor(() => expect(mockStore.setAudioTag).toHaveBeenCalledTimes(songs.length));
      const probeCalls = (IpcClient.invoke as any).mock.calls.filter(
        (call: unknown[]) => call[0] === 'musicApi:call' && call[1] === 'probeSongsBatch'
      );
      expect(probeCalls).toHaveLength(1);
      expect(probeCalls[0][2]).toHaveLength(songs.length);
    });

    it('快速连搜：旧搜索在途探测结果被丢弃，不写入新结果集', async () => {
      vi.useRealTimers();
      const { IpcClient } = await import('../services/IpcClient');

      const firstSongs = [{ id: 'old1', name: '旧歌', artist: '歌手甲', url: '' }];
      const secondSongs = [{ id: 'new1', name: '新歌', artist: '歌手乙', url: '' }];

      // 第一次搜索的探测批次挂起（手动放行），第二次搜索立即返回
      let releaseOldProbe: (() => void) | undefined;
      let oldInFlight = false;
      (IpcClient.invoke as any).mockImplementation(async (_ch: string, method?: string, arg?: unknown) => {
        if (method === 'searchSongs') {
          return arg === '周杰伦' ? firstSongs : secondSongs;
        }
        if (method === 'probeSongsBatch') {
          if (!oldInFlight) {
            oldInFlight = true;
            await new Promise<void>((resolve) => { releaseOldProbe = resolve; });
            return [{ songId: 'old1', tag: 'stale' as const }];
          }
          return [{ songId: 'new1', tag: 'valid' as const }];
        }
        return undefined;
      });

      const p1 = searchService.search('周杰伦');
      await vi.waitFor(() => expect(oldInFlight).toBe(true));
      // 旧搜索在途时立即发起新搜索（probeSeq++ → 旧探测变 stale）
      await searchService.search('新词');
      // 旧搜索的探测姗姗来迟，但其结果不得写入
      releaseOldProbe!();

      await vi.waitFor(() => {
        const tags = (IpcClient.invoke as any).mock.calls.filter(
          (call: unknown[]) => call[1] === 'probeSongsBatch' && (call[2] as any[])[0]?.id === 'new1'
        );
        expect(tags).toHaveLength(1);
      });
      await p1;

      // 迟到的旧探测结果（old1/stale）不得写入；只有新结果被写入
      expect(mockStore.setAudioTag).not.toHaveBeenCalledWith('old1', 'stale');
      expect(mockStore.setAudioTag).toHaveBeenCalledWith('new1', 'valid');
    });
  });

  describe('debouncedSearch', () => {
    it('应延迟执行搜索', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue([]);

      searchService.debouncedSearch('周杰伦');
      expect(IpcClient.invoke).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(IpcClient.invoke).toHaveBeenCalled();
    });
  });

  describe('batchSearch', () => {
    it('应调用 IPC 批量搜索', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockResult = { '周杰伦': [{ id: '1', name: '稻香' }] };
      (IpcClient.invoke as any).mockResolvedValue(mockResult);

      const result = await searchService.batchSearch(['周杰伦', '林俊杰']);

      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:call', 'batchSearch', ['周杰伦', '林俊杰'], 'netease');
      expect(result).toEqual(mockResult);
    });

    it('失败应返回空对象', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockRejectedValue(new Error('失败'));

      const result = await searchService.batchSearch(['周杰伦']);
      expect(result).toEqual({});
    });
  });
});
