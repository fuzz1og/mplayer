import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlayerBar from '../components/PlayerBar';
import { usePlayerStore } from '../store/playerStore';
import { useFavoriteStore } from '../store/favoriteStore';

// Mock stores
vi.mock('../store/playerStore', () => ({
  usePlayerStore: vi.fn()
}));

vi.mock('../store/favoriteStore', () => ({
  useFavoriteStore: vi.fn()
}));

// Mock coverCacheService
vi.mock('../services/coverCacheService', () => ({
  useCachedCover: vi.fn((url: string) => url)
}));

// Mock 子组件
vi.mock('../components/PlayerControls', () => ({
  default: () => <div data-testid="player-controls">PlayerControls</div>
}));

vi.mock('../components/PlayerProgress', () => ({
  default: () => <div data-testid="player-progress">PlayerProgress</div>
}));

vi.mock('../components/PlayerVolume', () => ({
  default: () => <div data-testid="player-volume">PlayerVolume</div>
}));

vi.mock('../components/PlayModeButton', () => ({
  default: () => <div data-testid="play-mode-button">PlayModeButton</div>
}));

describe('PlayerBar', () => {
  const mockPlayerStore = {
    currentSong: null,
    isPlaying: false,
    volume: 80,
    position: 0,
    duration: 0,
    playMode: 'sequence',
    pause: vi.fn(),
    resume: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setPlayMode: vi.fn(),
    playNext: vi.fn(),
    playPrevious: vi.fn()
  };

  const mockFavoriteStore = {
    isFavorite: vi.fn(),
    toggleFavorite: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // 支持选择器调用：usePlayerStore(selector) 返回 selector(store)
    (usePlayerStore as any).mockImplementation((selector?: any) => {
      if (typeof selector === 'function') return selector(mockPlayerStore);
      return mockPlayerStore;
    });
    (useFavoriteStore as any).mockImplementation((selector?: any) => {
      if (typeof selector === 'function') return selector(mockFavoriteStore);
      return mockFavoriteStore;
    });
  });

  it('应该渲染播放器栏', () => {
    render(<PlayerBar />);
    expect(screen.getByText('未播放')).toBeInTheDocument();
  });

  it('应该显示当前歌曲信息', () => {
    const storeWithSong = {
      ...mockPlayerStore,
      currentSong: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' }
    };
    (usePlayerStore as any).mockImplementation((selector?: any) => {
      if (typeof selector === 'function') return selector(storeWithSong);
      return storeWithSong;
    });

    render(<PlayerBar />);
    expect(screen.getByText('稻香')).toBeInTheDocument();
    expect(screen.getByText('周杰伦')).toBeInTheDocument();
  });

  it('应该显示子组件', () => {
    render(<PlayerBar />);
    expect(screen.getByTestId('player-controls')).toBeInTheDocument();
    expect(screen.getByTestId('player-progress')).toBeInTheDocument();
    expect(screen.getByTestId('player-volume')).toBeInTheDocument();
  });

  it('应该显示播放器容器', () => {
    render(<PlayerBar />);
    const playerBar = screen.getByText('未播放').closest('div');
    expect(playerBar).toBeInTheDocument();
  });
});
