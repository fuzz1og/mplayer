import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from '../store/searchStore';

describe('searchStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useSearchStore.setState({
      songs: [],
      loading: false,
      hasMore: true,
      page: 1,
      currentKeyword: '',
      sourceType: 'all',
      error: null,
      groups: [],
      expandedKeys: []
    });
  });

  describe('搜索状态管理', () => {
    it('应该设置搜索关键词', () => {
      const { setCurrentKeyword } = useSearchStore.getState();
      setCurrentKeyword('周杰伦');
      expect(useSearchStore.getState().currentKeyword).toBe('周杰伦');
    });

    it('应该设置搜索结果', () => {
      const { setSongs } = useSearchStore.getState();
      const mockSongs = [
        { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' }
      ];
      setSongs(mockSongs);
      expect(useSearchStore.getState().songs).toEqual(mockSongs);
    });

    it('应该设置加载状态', () => {
      const { setLoading } = useSearchStore.getState();
      setLoading(true);
      expect(useSearchStore.getState().loading).toBe(true);
    });

    it('应该设置错误信息', () => {
      const { setError } = useSearchStore.getState();
      setError('网络错误');
      expect(useSearchStore.getState().error).toBe('网络错误');
    });

    it('应该设置音源', () => {
      const { setSourceType } = useSearchStore.getState();
      setSourceType('qq');
      expect(useSearchStore.getState().sourceType).toBe('qq');
    });

    it('应该设置页码', () => {
      const { setPage } = useSearchStore.getState();
      setPage(2);
      expect(useSearchStore.getState().page).toBe(2);
    });

    it('应该重置搜索状态', () => {
      const { setCurrentKeyword, setSongs, setLoading, reset } = useSearchStore.getState();
      setCurrentKeyword('测试');
      setSongs([{ id: '1', name: '测试', artist: '测试', album: '测试' }]);
      setLoading(true);
      reset();
      expect(useSearchStore.getState().currentKeyword).toBe('');
      expect(useSearchStore.getState().songs).toEqual([]);
      expect(useSearchStore.getState().loading).toBe(false);
    });
  });

  describe('搜索结果处理', () => {
    it('应该追加搜索结果（去重）', () => {
      const { setSongs } = useSearchStore.getState();
      const initialSongs = [
        { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' }
      ];
      const newSongs = [
        { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' }
      ];
      setSongs(initialSongs, true);
      setSongs(newSongs, false); // replace=false 表示追加
      expect(useSearchStore.getState().songs).toHaveLength(2);
    });

    it('应该设置是否有更多结果', () => {
      const { setHasMore } = useSearchStore.getState();
      setHasMore(false);
      expect(useSearchStore.getState().hasMore).toBe(false);
    });

    it('应该设置分组', () => {
      const { setGroups } = useSearchStore.getState();
      const mockGroups = [
        { key: 'netease', name: '网易云音乐', songs: [] },
        { key: 'qq', name: 'QQ音乐', songs: [] }
      ];
      setGroups(mockGroups);
      expect(useSearchStore.getState().groups).toEqual(mockGroups);
    });

    it('应该切换分组展开状态', () => {
      const { toggleGroup } = useSearchStore.getState();
      toggleGroup('netease');
      expect(useSearchStore.getState().expandedKeys).toContain('netease');
      toggleGroup('netease');
      expect(useSearchStore.getState().expandedKeys).not.toContain('netease');
    });
  });
});
