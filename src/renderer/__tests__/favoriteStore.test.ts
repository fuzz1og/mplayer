import { describe, it, expect, beforeEach } from 'vitest';
import { useFavoriteStore } from '../store/favoriteStore';

describe('favoriteStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useFavoriteStore.setState({
      favoriteIds: [],
      favorites: [],
      loading: false,
      error: null
    });
  });

  describe('收藏状态管理', () => {
    it('应该检查是否已收藏', () => {
      const { isFavorite } = useFavoriteStore.getState();
      // 初始状态应该没有收藏
      expect(isFavorite('1')).toBe(false);
    });

    it('应该设置加载状态', () => {
      useFavoriteStore.setState({ loading: true });
      expect(useFavoriteStore.getState().loading).toBe(true);
    });

    it('应该设置错误信息', () => {
      useFavoriteStore.setState({ error: '网络错误' });
      expect(useFavoriteStore.getState().error).toBe('网络错误');
    });

    it('应该设置收藏列表', () => {
      const mockFavorites = [
        { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' },
        { id: '2', name: '青花瓷', artist: '周杰伦', album: '我很忙' }
      ];
      useFavoriteStore.setState({ favorites: mockFavorites });
      expect(useFavoriteStore.getState().favorites).toEqual(mockFavorites);
    });

    it('应该设置收藏ID列表', () => {
      useFavoriteStore.setState({ favoriteIds: ['1', '2'] });
      expect(useFavoriteStore.getState().favoriteIds).toEqual(['1', '2']);
    });
  });

  describe('收藏操作', () => {
    it('应该判断歌曲是否已收藏', () => {
      useFavoriteStore.setState({ favoriteIds: ['1', '2'] });
      const { isFavorite } = useFavoriteStore.getState();
      expect(isFavorite('1')).toBe(true);
      expect(isFavorite('3')).toBe(false);
    });
  });
});
