import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PlayerBar from '../components/PlayerBar';
import { usePlayerStore } from '../store/playerStore';
import { useFavoriteStore } from '../store/favoriteStore';
import { playbackClock } from '../services/playbackClock';

const testDir = dirname(fileURLToPath(String(import.meta.url)));
const playerBarCss = readFileSync(join(testDir, '..', 'styles', 'player-bar.css'), 'utf8');

/** 取「整行只有该选择器 + {」的规则体；组选择器（行尾带逗号）不参与匹配。 */
function cssBlock(selector: string): string {
  const lines = playerBarCss.split('\n');
  const start = lines.findIndex((line) => line.trim() === selector + ' {');
  if (start === -1) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim() !== '}'; i += 1) body.push(lines[i]);
  return body.join('\n');
}

// Mock stores
vi.mock('../store/playerStore', () => ({
  usePlayerStore: vi.fn()
}));

vi.mock('../store/favoriteStore', () => ({
  useFavoriteStore: vi.fn()
}));

// Mock 子组件（PlayerVolume 保留真实实现，本文件要验音量折叠结构）
vi.mock('../components/PlayerControls', () => ({
  default: () => <div data-testid="player-controls">PlayerControls</div>
}));


describe('PlayerBar', () => {
  const mockPlayerStore = {
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    volume: 80,
    playMode: '列表循环',
    pause: vi.fn(),
    resume: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setPlayMode: vi.fn(),
    playNext: vi.fn(),
    playPrevious: vi.fn()
  };

  const mockFavoriteStore = {
    // PlayerBar 的收藏态现在直接选 favoriteIds（#620）：替身必须给出同一字段，
    // 否则 selector 在替身上读 undefined.includes 会崩。
    favoriteIds: [] as string[],
    isFavorite: vi.fn(),
    toggleFavorite: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // 进度块自订阅 playbackClock：每个用例从空快照开始，避免互相污染
    playbackClock.destroy();
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

  it('应该显示子组件（进度条走真实实现，不再被 mock 掉）', () => {
    render(<PlayerBar />);
    expect(screen.getByTestId('player-controls')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '播放进度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '静音' })).toBeInTheDocument();
  });

  it('右簇只有队列、更多、音量——没有重复的「歌词」麦克风按钮', () => {
    render(<PlayerBar />);
    expect(screen.getByRole('button', { name: '队列' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '静音' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '歌词' })).toBeNull();
  });

  it('三列 grid：左右各 1fr、中间 auto，播放键落在窗口中心', () => {
    const block = cssBlock('.player-bar');
    expect(block).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(block).not.toContain('border-top');
    expect(cssBlock('.player-bar__center')).toContain('width: 500px');
  });

  it('音量默认收起：滑杆在 popover 里，hover / focus-within 才展开', () => {
    const { container } = render(<PlayerBar />);
    const volume = container.querySelector('.player-volume') as HTMLElement;
    expect(volume.querySelector('.player-volume__popover')).toBeTruthy();
    expect(screen.getByRole('slider', { name: '音量' }).closest('.player-volume__popover')).toBeTruthy();

    const popover = cssBlock('.player-volume__popover');
    expect(popover).toContain('opacity: 0');
    expect(popover).toContain('pointer-events: none');
    expect(playerBarCss).toContain('.player-volume:hover .player-volume__popover');
    expect(playerBarCss).toContain('.player-volume:focus-within .player-volume__popover');
  });

  it('静音点击保留：音量 80 → 0', () => {
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: '静音' }));
    expect(mockPlayerStore.setVolume).toHaveBeenCalledWith(0);
  });

  it('更多菜单 ESC 关闭并把焦点还给触发按钮', () => {
    render(<PlayerBar />);
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '加入歌单' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '更多操作' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('更多菜单方向键在可用菜单项之间循环移动焦点', () => {
    const storeWithSong = {
      ...mockPlayerStore,
      currentSong: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' }
    };
    (usePlayerStore as any).mockImplementation((selector?: any) => {
      if (typeof selector === 'function') return selector(storeWithSong);
      return storeWithSong;
    });

    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const add = screen.getByRole('menuitem', { name: '加入歌单' });
    const download = screen.getByRole('menuitem', { name: '下载' });
    expect(add).toHaveFocus();
    fireEvent.keyDown(add, { key: 'ArrowDown' });
    expect(download).toHaveFocus();
    fireEvent.keyDown(download, { key: 'ArrowDown' });
    expect(add).toHaveFocus();
    fireEvent.keyDown(add, { key: 'ArrowUp' });
    expect(download).toHaveFocus();
  });

  it('没有当前歌时下载项禁用，方向键停在可用项上', () => {
    render(<PlayerBar />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const add = screen.getByRole('menuitem', { name: '加入歌单' });
    expect(screen.getByRole('menuitem', { name: '下载' })).toBeDisabled();
    fireEvent.keyDown(add, { key: 'ArrowDown' });
    expect(add).toHaveFocus();
  });

  it('播放位置推进只重渲染进度块，PlayerBar 自身不重渲染（位置不再经全局 store）', () => {
    const storeWithSong = {
      ...mockPlayerStore,
      currentSong: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' }
    };
    (usePlayerStore as any).mockImplementation((selector?: any) => {
      if (typeof selector === 'function') return selector(storeWithSong);
      return storeWithSong;
    });
    playbackClock.connect(() => 0);
    playbackClock.setDuration(200);
    playbackClock.setPosition(30);

    render(<PlayerBar />);
    expect(screen.getByText('00:30')).toBeInTheDocument();
    const selectorCallsBefore = (usePlayerStore as any).mock.calls.length;

    act(() => { playbackClock.setPosition(45); });

    // 进度块（叶子）自己订阅时钟，立即更新
    expect(screen.getByText('00:45')).toBeInTheDocument();
    // PlayerBar 的 store 选择器一次都没再跑 = PlayerBar 没有重渲染
    expect((usePlayerStore as any).mock.calls.length).toBe(selectorCallsBefore);
  });

  it('应该显示播放器容器', () => {
    render(<PlayerBar />);
    const playerBar = screen.getByText('未播放').closest('div');
    expect(playerBar).toBeInTheDocument();
  });

  it('加入歌单弹窗应 portal 到 body，不落在播放栏子树内（#245）', async () => {
    const storeWithSong = {
      ...mockPlayerStore,
      currentSong: { id: '1', name: '稻香', artist: '周杰伦', album: '魔杰座' }
    };
    (usePlayerStore as any).mockImplementation((selector?: any) => {
      if (typeof selector === 'function') return selector(storeWithSong);
      return storeWithSong;
    });

    render(<PlayerBar />);
    // setup 默认 invoke 返回 { success: true }（无 data），弹窗 load 歌单会拿到 undefined 渲染崩溃，覆盖为空歌单
    (window as any).electronAPI.invoke.mockResolvedValue({ success: true, data: [] });
    // 加入歌单收在「更多操作」菜单里
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '加入歌单' }));

    const modalHeading = await screen.findByText('加入歌单');
    // 从播放栏内按钮上溯到渲染容器（body 直接子节点）：弹窗不应落在该子树内，
    // 否则会被 PlayerBar 的 backdropFilter 包含块捕获而定位错乱（#245）
    let barSubtree: HTMLElement = screen.getByRole('button', { name: '更多操作' });
    while (barSubtree.parentElement && barSubtree.parentElement !== document.body) {
      barSubtree = barSubtree.parentElement;
    }
    expect(barSubtree.contains(modalHeading)).toBe(false);
  });
});
