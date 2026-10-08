import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlayerBar from '../components/PlayerBar';
import { usePlayerStore } from '../store/playerStore';
import { useFavoriteStore } from '../store/favoriteStore';
import type { Song } from '@mplayer/core';

// 重子组件只做替身，**两个 store 保持真实实现**：本用例要证明的正是「favoriteIds
// 变化时，真实 zustand 订阅会不会把新值送进 PlayerBar」——把 store 换成 mock
// （每次调用直接把 selector 打在静态对象上）会把这个订阅语义连同 bug 一起短路掉。
vi.mock('../components/PlayerControls', () => ({ default: () => <div data-testid="player-controls" /> }));
vi.mock('../components/PlayerVolume', () => ({ default: () => <div data-testid="player-volume" /> }));
vi.mock('../components/PlayerProgress', () => ({ default: () => <div data-testid="player-progress" /> }));
vi.mock('../components/AddToPlaylistModal', () => ({ default: () => null }));

const song = {
  id: '620-1',
  name: '稻香',
  artist: '周杰伦',
  album: '魔杰座',
  sourceType: 'netease',
} as unknown as Song;

describe('PlayerBar 收藏按钮（#620）', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentSong: song,
      isPlaying: false,
      isLoading: false,
      volume: 80,
      playMode: 'sequence',
    });
    useFavoriteStore.setState({ favoriteIds: [], favorites: [], loading: false, error: null });
    (window as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } }).electronAPI.invoke
      .mockResolvedValue({ success: true });
  });

  it('切换收藏时心形按钮的 aria-label 立即在「收藏」与「取消收藏」之间翻转', async () => {
    render(<PlayerBar />);

    const button = screen.getByRole('button', { name: '收藏' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    // 点收藏 → store 同步写入 favoriteIds；按钮必须因订阅值变化而重渲染
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true');
    });
    expect(useFavoriteStore.getState().favoriteIds).toContain(song.id);

    // 再点 → 回到未收藏态
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收藏' })).toHaveAttribute('aria-pressed', 'false');
    });
    expect(useFavoriteStore.getState().favoriteIds).not.toContain(song.id);
  });
});
