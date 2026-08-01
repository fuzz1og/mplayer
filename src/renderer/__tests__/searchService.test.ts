import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStore } = vi.hoisted(() => {
  const store = {
    sourceType: 'netease' as const,
    currentKeyword: '',
    page: 1,
    hasMore: true,
    loading: false,
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
    mockStore.songs = [];
    mockStore.groups = [];
  });

  afterEach(() => { vi.useRealTimers(); });

  describe('search', () => {
    it('应设置 loading 并调用 IPC', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockSongs = [{ id: '1', name: '稻香', artist: '周杰伦' }];
      (IpcClient.invoke as any).mockResolvedValue(mockSongs);

      await searchService.search('周杰伦');

      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ loading: true }));
      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:searchSongs', '周杰伦', 1, 'netease');
      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
    });

    it('IPC 失败应设置错误信息', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockRejectedValue(new Error('网络错误'));

      await searchService.search('周杰伦');

      expect(mockStore.setState).toHaveBeenCalledWith(expect.objectContaining({ error: '搜索失败，请重试' }));
    });

    it('probes every result in progressive batches', async () => {
      vi.useRealTimers();
      const { IpcClient } = await import('../services/IpcClient');
      const songs = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`,
        name: `song-${i}`,
        artist: 'artist',
        url: '',
      }));
      (IpcClient.invoke as any).mockImplementation(async (channel: string) => {
        if (channel === 'musicApi:searchSongs') return songs;
        if (channel === 'musicApi:getAudioUrl') return '';
        return undefined;
      });

      await searchService.search('周杰伦');

      await vi.waitFor(() => expect(mockStore.setAudioTag).toHaveBeenCalledTimes(songs.length));
      const audioUrlCalls = (IpcClient.invoke as any).mock.calls.filter(
        (call: unknown[]) => call[0] === 'musicApi:getAudioUrl'
      );
      expect(audioUrlCalls).toHaveLength(songs.length);
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

      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:batchSearch', ['周杰伦', '林俊杰'], 'netease');
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
