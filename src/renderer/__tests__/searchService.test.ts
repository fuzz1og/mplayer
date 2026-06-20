import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchService } from '../services/searchService';

// Mock IpcClient
vi.mock('../services/IpcClient', () => ({
  IpcClient: {
    invoke: vi.fn()
  }
}));

// Mock searchStore
const mockStore = {
  sourceType: 'netease' as const,
  currentKeyword: '',
  page: 1,
  hasMore: true,
  loading: false,
  songs: [] as any[],
  groups: [] as any[],
  setLoading: vi.fn(),
  setError: vi.fn(),
  setCurrentKeyword: vi.fn(),
  setSongs: vi.fn(),
  setGroups: vi.fn(),
  setPage: vi.fn(),
  setHasMore: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../store/searchStore', () => ({
  useSearchStore: {
    getState: () => mockStore,
  }
}));

describe('searchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 重置 mock store 状态
    mockStore.sourceType = 'netease';
    mockStore.currentKeyword = '';
    mockStore.page = 1;
    mockStore.hasMore = true;
    mockStore.loading = false;
    mockStore.songs = [];
    mockStore.groups = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('search', () => {
    it('空关键词应重置状态', async () => {
      await searchService.search('');
      expect(mockStore.reset).toHaveBeenCalled();
    });

    it('应设置 loading 并调用 IPC', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      const mockSongs = [{ id: '1', name: '稻香', artist: '周杰伦' }];
      (IpcClient.invoke as any).mockResolvedValue(mockSongs);

      await searchService.search('周杰伦');

      expect(mockStore.setLoading).toHaveBeenCalledWith(true);
      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:searchSongs', '周杰伦', 1, 'netease');
      expect(mockStore.setSongs).toHaveBeenCalledWith(mockSongs, true);
      expect(mockStore.setPage).toHaveBeenCalledWith(1);
      expect(mockStore.setLoading).toHaveBeenCalledWith(false);
    });

    it('IPC 失败应设置错误信息', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockRejectedValue(new Error('网络错误'));

      await searchService.search('周杰伦');

      expect(mockStore.setError).toHaveBeenCalledWith('网络错误');
      expect(mockStore.setLoading).toHaveBeenCalledWith(false);
    });

    it('第一页应清空已有歌曲', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue([]);

      await searchService.search('周杰伦', 1);

      expect(mockStore.setSongs).toHaveBeenCalledWith([], true);
    });

    it('hasMore 应基于结果数量判断', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue(new Array(10).fill({ id: '1' }));

      await searchService.search('周杰伦');

      expect(mockStore.setHasMore).toHaveBeenCalledWith(true);
    });
  });

  describe('debouncedSearch', () => {
    it('应延迟执行搜索', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue([]);

      searchService.debouncedSearch('周杰伦');

      // 未到延迟时间，不应调用
      expect(IpcClient.invoke).not.toHaveBeenCalled();

      // 快进到延迟时间
      vi.advanceTimersByTime(300);

      expect(IpcClient.invoke).toHaveBeenCalled();
    });

    it('多次调用应只执行最后一次', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      (IpcClient.invoke as any).mockResolvedValue([]);

      searchService.debouncedSearch('周');
      searchService.debouncedSearch('周杰');
      searchService.debouncedSearch('周杰伦');

      vi.advanceTimersByTime(300);

      // 只应调用一次（最后一次的关键词）
      expect(IpcClient.invoke).toHaveBeenCalledTimes(1);
      expect(IpcClient.invoke).toHaveBeenCalledWith('musicApi:searchSongs', '周杰伦', 1, 'netease');
    });
  });

  describe('loadMore', () => {
    it('无关键词时不应加载', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      mockStore.currentKeyword = '';

      await searchService.loadMore();

      expect(IpcClient.invoke).not.toHaveBeenCalled();
    });

    it('hasMore=false 时不应加载', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      mockStore.currentKeyword = '周杰伦';
      mockStore.hasMore = false;

      await searchService.loadMore();

      expect(IpcClient.invoke).not.toHaveBeenCalled();
    });

    it('loading 时不应加载', async () => {
      const { IpcClient } = await import('../services/IpcClient');
      mockStore.currentKeyword = '周杰伦';
      mockStore.loading = true;

      await searchService.loadMore();

      expect(IpcClient.invoke).not.toHaveBeenCalled();
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

  describe('reset', () => {
    it('应调用 store reset', () => {
      searchService.reset();
      expect(mockStore.reset).toHaveBeenCalled();
    });
  });
});
